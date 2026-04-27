/* @vitest-environment node */

import { afterAll, beforeAll, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { createContext, eventsDomain, type ContextItem } from "@ekairos/events"
import { Sandbox } from "@ekairos/sandbox/sandbox"
import { init } from "@instantdb/admin"
import { readPersistedContextStepStream } from "@ekairos/events/runtime"

import { createCodexReactor, type CodexConfig, type CodexExecuteTurnArgs, type CodexTurnResult } from "../index.js"
import { describeInstant, itInstant, destroyContextTestApp, provisionContextTestApp } from "./_env.ts"
import { configureRuntime } from "../../../../domain/src/runtime.ts"

type TestContext = Record<string, unknown>
type TestEnv = {
  actorId: string
  appServerUrl: string
  repoPath: string
  providerContextId?: string
  model?: string
  approvalPolicy?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function truncate(value: string, max = 400): string {
  const text = asString(value)
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function isValidProviderContextId(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true
  return false
}

function createTriggerEvent(text: string): ContextItem {
  return {
    id: randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text }],
    },
    status: "stored",
  }
}

function createStageTimer() {
  const startedAt = Date.now()
  const stageTimingsMs: Record<string, number> = {}
  let currentStage: string | undefined

  return {
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const previous = currentStage
      currentStage = name
      const stageStartedAt = Date.now()
      try {
        return await run()
      } finally {
        stageTimingsMs[name] = Math.max(0, Date.now() - stageStartedAt)
        currentStage = previous
      }
    },
    add(name: string, value: number) {
      stageTimingsMs[name] = Math.max(0, Math.round((stageTimingsMs[name] ?? 0) + value))
    },
    getCurrentStage() {
      return currentStage
    },
    snapshot() {
      return {
        totalMs: Math.max(0, Date.now() - startedAt),
        stageTimingsMs: { ...stageTimingsMs },
      }
    },
  }
}

function collectWritableChunks() {
  const written: Record<string, unknown>[] = []
  const writable = new WritableStream<unknown>({
    write(chunk) {
      written.push(asRecord(chunk))
    },
  })
  return { writable, written }
}

function getChunkPayloads(written: Record<string, unknown>[]) {
  return written
    .filter((entry) => asString(entry.type) === "data-chunk.emitted")
    .map((entry) => asRecord(entry.data))
}

async function executeRealTurnViaHttp(
  args: CodexExecuteTurnArgs<TestContext, CodexConfig, TestEnv>,
): Promise<{ turn: CodexTurnResult; providerChunks: Record<string, unknown>[] }> {
  const baseUrl = asString(args.config.appServerUrl).replace(/\/turn$/, "")
  const rpcUrl = `${baseUrl}/rpc`
  const eventsUrl = `${baseUrl}/events`
  const providerChunks: Record<string, unknown>[] = []
  const sendRpc = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    })
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      throw new Error(
        `Codex RPC failed (${method}) ${response.status}: ${errorBody || response.statusText}`,
      )
    }
    return asRecord(await response.json())
  }

  const eventsResponse = await fetch(eventsUrl, { method: "GET" })
  if (!eventsResponse.ok || !eventsResponse.body) {
    const errorBody = await eventsResponse.text().catch(() => "")
    throw new Error(
      `Codex events subscribe failed (${eventsResponse.status}): ${errorBody || eventsResponse.statusText}`,
    )
  }

  const requestedThreadId = asString(args.config.providerContextId).trim()
  let threadId = requestedThreadId
  if (threadId && isValidProviderContextId(threadId)) {
    await sendRpc("thread/resume", { threadId })
  } else {
    const startParams: Record<string, unknown> = {
      cwd: args.config.repoPath,
      approvalPolicy: args.config.approvalPolicy ?? "never",
      sandboxPolicy:
        args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
          ? args.config.sandboxPolicy
          : { type: "externalSandbox", networkAccess: "enabled" },
    }
    if (args.config.model) startParams.model = args.config.model
    const startRes = await sendRpc("thread/start", startParams)
    threadId =
      asString(asRecord(asRecord(startRes.result).thread).id) ||
      asString(asRecord(startRes.result).id) ||
      asString(startRes.threadId)
  }
  if (!threadId) throw new Error("thread_id_missing")

  const turnStartParams: Record<string, unknown> = {
    threadId,
    input: [{ type: "text", text: args.instruction || "" }],
    cwd: args.config.repoPath,
    approvalPolicy: args.config.approvalPolicy ?? "never",
    sandboxPolicy:
      args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
        ? args.config.sandboxPolicy
        : { type: "externalSandbox", networkAccess: "enabled" },
  }
  if (args.config.model) turnStartParams.model = args.config.model
  const turnStartRes = await sendRpc("turn/start", turnStartParams)
  let turnId =
    asString(asRecord(asRecord(turnStartRes.result).turn).id) ||
    asString(asRecord(turnStartRes.result).id) ||
    asString(turnStartRes.turnId)

  const reader = eventsResponse.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let done = false
  let assistantText = ""
  let reasoningText = ""
  let diff = ""
  let usage: Record<string, unknown> = {}
  let completedTurn: Record<string, unknown> = {}

  while (!done) {
    const read = await reader.read()
    done = Boolean(read.done)
    if (!read.value) continue
    buffer += decoder.decode(read.value, { stream: !done })
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() ?? ""
    for (const block of blocks) {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
      if (!lines.length) continue
      const data = lines.map((line) => line.slice(5).trim()).join("\n")
      if (!data || data === "[DONE]") continue
      const evt = asRecord(JSON.parse(data))
      const method = asString(evt.method)
      const params = asRecord(evt.params)
      const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id)
      const evtThreadId = asString(params.threadId) || asString(asRecord(params.turn).threadId)
      const scopedToTurn =
        (evtTurnId && turnId && evtTurnId === turnId) ||
        (evtThreadId && evtThreadId === threadId) ||
        method.startsWith("thread/")
      if (!scopedToTurn) continue

      providerChunks.push(evt)
      await args.emitChunk(evt)

      if (method === "turn/started" && !turnId) {
        turnId = asString(asRecord(params.turn).id) || evtTurnId
      }
      if (method === "item/agentMessage/delta") {
        assistantText += asString(params.delta)
      }
      if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
        reasoningText += asString(params.delta)
      }
      if (method === "turn/diff/updated") {
        diff = asString(params.diff)
      }
      if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") {
        usage = asRecord(params.tokenUsage)
      }
      if (method === "item/completed") {
        const item = asRecord(params.item)
        if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
          assistantText = asString(item.text)
        }
        if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
          reasoningText = asString(item.summary)
        }
      }
      if (method === "turn/completed") {
        const turnData = asRecord(params.turn)
        const completedTurnId = asString(turnData.id)
        if (completedTurnId && turnId && completedTurnId !== turnId) continue
        completedTurn = turnData
        done = true
        break
      }
    }
  }

  return {
    providerChunks,
    turn: {
      providerContextId: threadId,
      turnId: asString(completedTurn.id || turnId || `turn:${Date.now()}`),
      assistantText,
      reasoningText,
      diff,
      usage: asRecord(usage),
      metadata: {
        providerResponse: completedTurn,
      },
    },
  }
}

function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  const value = root[key]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

function readString(row: Record<string, unknown> | undefined, key: string): string | null {
  if (!row) return null
  const value = row[key]
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

let appId: string | null = null
let db: ReturnType<typeof init> | null = null
const hasCodexAppServer = Boolean(
  asString(process.env.CODEX_REACTOR_REAL_URL).trim() ||
    asString(process.env.CODEX_APP_SERVER_URL).trim(),
)

function currentDb() {
  if (!db) {
    throw new Error("Codex reactor Instant DB is not initialized.")
  }
  return db
}

const itCodexInstant = hasCodexAppServer ? itInstant : it.skip

describeInstant("codex reactor + Instant integration", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `codex-reactor-instant-${Date.now()}`,
      schema,
    })
    appId = app.appId
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
    })

    configureRuntime({
      domain: { domain: eventsDomain },
      runtime: async () => ({ db: currentDb() }),
    })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 5 * 60 * 1000)

  itCodexInstant("captures full Codex output and verifies persisted context state against an ephemeral app", async () => {
    const appServerUrl =
      asString(process.env.CODEX_REACTOR_REAL_URL).trim() ||
      asString(process.env.CODEX_APP_SERVER_URL).trim()

    const repoPath = resolve(process.cwd(), "..", "..", "..")
    const timer = createStageTimer()
    const collected = collectWritableChunks()
    const providerChunks: Record<string, unknown>[] = []
    const contextKey = `codex-reactor-instant:${Date.now()}`

    const codexContext = createContext<TestEnv>("codex.reactor.instant.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: env.repoPath,
      }))
      .narrative(
        () =>
          "Inspect the repository and answer without modifying files. Focus on README and the codex reactor package.",
      )
      .actions(() => ({}))
      .reactor(
        createCodexReactor<TestContext, CodexConfig, TestEnv>({
          includeReasoningPart: true,
          includeStreamTraceInOutput: true,
          includeRawProviderChunksInOutput: true,
          resolveConfig: async ({ env }) => ({
            appServerUrl: env.appServerUrl,
            repoPath: env.repoPath,
            providerContextId: env.providerContextId,
            model: env.model,
            approvalPolicy: env.approvalPolicy ?? "never",
          }),
          executeTurn: async (args) => {
            const executed = await executeRealTurnViaHttp(args)
            providerChunks.push(...executed.providerChunks)
            return executed.turn
          },
        }),
      )
      .shouldContinue(() => false)
      .build()

    const triggerEvent = createTriggerEvent(
      "Read packages/reactors/openai-reactor/README.md and summarize what createCodexReactor does. Do not modify files.",
    )

    const shell = await timer.measure("reactShellMs", async () =>
      await codexContext.react(triggerEvent, {
        env: {
          actorId: "codex-reactor-test-user",
          appServerUrl,
          repoPath,
          approvalPolicy: "never",
        },
        context: { key: contextKey },
        durable: false,
        __benchmark: timer,
        options: {
          silent: false,
          maxIterations: 1,
          maxModelSteps: 1,
          writable: collected.writable,
        },
      }),
    )
    const result = await timer.measure("reactRunMs", async () => await shell.run!)

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_contexts: {
          $: { where: { id: result.context.id as any }, limit: 1 },
        },
        event_executions: {
          $: { where: { id: result.execution.id as any }, limit: 1 },
        },
        event_steps: {
          $: { where: { "execution.id": result.execution.id }, limit: 20 },
        },
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
      }),
    )

    const contextRow = readRows(snapshot, "event_contexts")[0]
    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRows = readRows(snapshot, "event_steps")
    const itemRows = readRows(snapshot, "event_items")
    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
    const reactionContent = asRecord(reactionItem?.content)
    const reactionParts = Array.isArray(reactionContent.parts) ? reactionContent.parts : []
    const assistantTextPart = reactionParts.find((part) => asString(asRecord(part).type) === "message")
    const assistantText = asString(asRecord(asRecord(assistantTextPart).content).text)
    const commandParts = reactionParts.filter((part) => {
      const record = asRecord(part)
      const content = asRecord(record.content)
      return (
        asString(record.type) === "action" &&
        asString(content.actionName) === Sandbox.runCommandActionName
      )
    })
    const metadataPart = reactionParts.find((part) => {
      const record = asRecord(part)
      const content = asRecord(record.content)
      return (
        asString(record.type) === "action" &&
        asString(content.status) === "completed" &&
        asString(content.actionName) === "turnMetadata"
      )
    })
    const metadataContent = asRecord(asRecord(metadataPart).content)
    const codexOutput = asRecord(metadataContent.output)
    const streamTrace = asRecord(codexOutput.streamTrace)
    const emittedPayloads = getChunkPayloads(collected.written)
    const firstStepRow = stepRows[0]
    const stepStreamClientId = readString(firstStepRow, "streamClientId")
    const stepStreamId = readString(firstStepRow, "streamId")
    const persistedStream = await readPersistedContextStepStream({
      db: currentDb(),
      clientId: stepStreamClientId ?? undefined,
      streamId: stepStreamId ?? undefined,
    })
    const persistedStreamChunks = persistedStream.chunks.map((chunk) => asRecord(chunk))

    const audit = {
      test: "codex reactor + Instant integration",
      totalMs: timer.snapshot().totalMs,
      stageTimingsMs: timer.snapshot().stageTimingsMs,
      runtime: {
        appServerUrl,
        repoPath,
      },
      provider: {
        totalChunks: providerChunks.length,
        rawChunks: providerChunks,
      },
      stream: {
        emittedChunks: emittedPayloads.length,
        rawWritten: collected.written,
        payloads: emittedPayloads,
        persistedChunks: persistedStreamChunks,
      },
      persisted: {
        context: contextRow,
        execution: executionRow,
        steps: stepRows,
        items: itemRows,
        reaction: reactionItem,
        reactionParts,
        codexOutput,
        streamTrace,
      },
    }

    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `codex-reactor-instant-integration-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(audit, null, 2))
    // eslint-disable-next-line no-console
    console.log(`[codex-reactor-instant-audit] ${reportPath}`)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          totalMs: audit.totalMs,
          stageTimingsMs: audit.stageTimingsMs,
          providerChunks: audit.provider.totalChunks,
          emittedChunks: audit.stream.emittedChunks,
          providerContextId: asString(codexOutput.providerContextId),
          turnId: asString(codexOutput.turnId),
          assistantTextPreview: truncate(assistantText),
        },
        null,
        2,
      ),
    )

    expect(readString(contextRow, "status")).toBe("closed")
    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "activeStreamClientId")).toBe(null)
    expect(readString(executionRow, "lastStreamClientId")).toBe(stepStreamClientId)
    expect(stepRows.length).toBeGreaterThan(0)
    expect(itemRows.length).toBeGreaterThan(0)
    expect(reactionItem).toBeTruthy()
    expect(readString(reactionItem, "status")).toBe("completed")
    expect(providerChunks.length).toBeGreaterThan(0)
    expect(emittedPayloads.length).toBeGreaterThan(0)
    expect(stepStreamClientId).toBeTruthy()
    expect(stepStreamId).toBeTruthy()
    expect(persistedStreamChunks.length).toBeGreaterThan(0)
    expect(
      persistedStreamChunks.some(
        (chunk) =>
          asString(chunk.chunkType) === "chunk.text_delta" ||
          asString(chunk.chunkType) === "chunk.text_end",
      ),
    ).toBe(true)
    expect(commandParts.length).toBeGreaterThan(0)
    expect(asString(codexOutput.providerContextId)).not.toBe("")
    expect(asString(codexOutput.turnId)).not.toBe("")
    expect(assistantText).not.toBe("")
    expect(Array.isArray(streamTrace.chunks)).toBe(false)
  }, 10 * 60 * 1000)
})
