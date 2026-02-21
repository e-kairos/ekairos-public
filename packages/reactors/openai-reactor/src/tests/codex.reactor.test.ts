import type { UIMessageChunk } from "ai"
import { describe, expect, it } from "vitest"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import type { ThreadEnvironment } from "@ekairos/thread/runtime"
import type { ThreadItem, ThreadReactorParams } from "@ekairos/thread"

import {
  createCodexReactor,
  defaultMapCodexChunk,
  mapCodexChunkType,
  type CodexConfig,
  type CodexExecuteTurnArgs,
  type CodexMappedChunk,
  type CodexTurnResult,
} from "../index.js"

type TestContext = Record<string, unknown>
type TestEnv = ThreadEnvironment & {
  appServerUrl?: string
  repoPath?: string
  threadId?: string
}

type CollectedChunk = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function truncate(value: string, size = 220): string {
  const text = asString(value)
  if (text.length <= size) return text
  return `${text.slice(0, size)}...`
}

function providerEventType(chunk: Record<string, unknown>): string {
  return asString(chunk.method || chunk.type || chunk.event || "unknown")
}

function collectWritableChunks() {
  const written: CollectedChunk[] = []
  const writable = new WritableStream<unknown>({
    write(chunk) {
      written.push(asRecord(chunk))
    },
  })
  return { writable, written }
}

function createParams(params: {
  writable: WritableStream<unknown>
  eventId?: string
  contextId?: string
  executionId?: string
  stepId?: string
  iteration?: number
  threadId?: string
}): ThreadReactorParams<TestContext, TestEnv> {
  const threadId = asString(params.threadId || "thr-scripted") || "thr-scripted"
  const triggerEvent: ThreadItem = {
    id: "trigger-001",
    type: "input",
    channel: "web",
    createdAt: new Date("2026-02-20T00:00:00.000Z").toISOString(),
    content: {
      parts: [{ type: "text", text: "Open README and explain changes." }],
    },
    status: "stored",
  }

  return {
    env: {
      appServerUrl: "http://127.0.0.1:3436",
      repoPath: "/workspace/repo",
      threadId,
    },
    context: {
      id: params.contextId ?? "ctx-001",
      threadId,
      key: "ctx-scripted",
      status: "open",
      createdAt: new Date("2026-02-20T00:00:00.000Z"),
      content: {
        repository: "demo-repo",
      },
    },
    contextIdentifier: { id: params.contextId ?? "ctx-001" },
    triggerEvent,
    model: "openai/gpt-5.2-codex",
    systemPrompt: "You are Codex running as an Ekairos Thread.",
    actions: {},
    toolsForModel: {},
    eventId: params.eventId ?? "evt-001",
    executionId: params.executionId ?? "exe-001",
    contextId: params.contextId ?? "ctx-001",
    stepId: params.stepId ?? "step-001",
    iteration: params.iteration ?? 0,
    maxModelSteps: 6,
    sendStart: true,
    silent: false,
    writable: params.writable as WritableStream<UIMessageChunk>,
  }
}

function getChunkPayloads(written: CollectedChunk[]) {
  return written
    .filter((entry) => asString(entry.type) === "data-chunk.emitted")
    .map((entry) => asRecord(entry.data))
}

function getCodexEventPart(assistantEvent: ThreadItem) {
  const parts = Array.isArray(assistantEvent.content?.parts)
    ? assistantEvent.content.parts
    : []
  const codexPart = parts.find((part) => asString(asRecord(part).type) === "codex-event")
  return asRecord(codexPart)
}

function getAssistantTextPart(assistantEvent: ThreadItem): string {
  const parts = Array.isArray(assistantEvent.content?.parts)
    ? assistantEvent.content.parts
    : []
  const textPart = parts.find((part) => asString(asRecord(part).type) === "text")
  return asString(asRecord(textPart).text).trim()
}

function summarizeProviderChunk(chunk: Record<string, unknown>): {
  eventType: string
  itemType: string
  itemId: string
  turnId: string
  threadId: string
  actionRef: string
  text: string
  error: string
} {
  const eventType = providerEventType(chunk)
  const params = asRecord(chunk.params)
  const item = asRecord(params.item)
  const eventTurn = asRecord(params.turn)
  const actionRef = asString(params.itemId || params.toolCallId || item.id || chunk.id)
  const text = truncate(
    asString(
      params.delta ||
        chunk.delta ||
        chunk.text ||
        item.text ||
        item.summary ||
        asRecord(chunk.error).message ||
        chunk.error,
    ),
  )
  const error = truncate(
    asString(asRecord(params.error).message || params.error || asRecord(chunk.error).message || chunk.error),
  )

  return {
    eventType,
    itemType: asString(item.type),
    itemId: asString(item.id || params.itemId),
    turnId: asString(params.turnId || eventTurn.id),
    threadId: asString(params.threadId || eventTurn.threadId),
    actionRef,
    text,
    error,
  }
}

function summarizeMappedPayload(payload: Record<string, unknown>): {
  method: string
  text: string
  error: string
} {
  const data = asRecord(payload.data)
  const params = asRecord(data.params)
  const item = asRecord(params.item)
  const method = asString(data.method || payload.providerChunkType || "")
  const text = truncate(
    asString(
      params.delta ||
        data.delta ||
        data.text ||
        item.text ||
        item.summary ||
        asRecord(params.error).message ||
        params.error,
    ),
  )
  const error = truncate(asString(asRecord(params.error).message || params.error))
  return { method, text, error }
}

function countBy<T>(items: readonly T[], mapper: (item: T) => string) {
  const counters = new Map<string, number>()
  for (const item of items) {
    const key = mapper(item)
    counters.set(key, (counters.get(key) ?? 0) + 1)
  }
  return Object.fromEntries(counters.entries())
}

function buildAudit(params: {
  name: string
  providerChunks: Record<string, unknown>[]
  written: CollectedChunk[]
  result: Awaited<ReturnType<ReturnType<typeof createCodexReactor<TestContext, CodexConfig, TestEnv>>>>
}) {
  const streamPayloads = getChunkPayloads(params.written)
  const codexPart = getCodexEventPart(params.result.assistantEvent)
  const output = asRecord(codexPart.output)
  const streamTrace = asRecord(output.streamTrace)
  const persistedChunks = Array.isArray(streamTrace.chunks)
    ? streamTrace.chunks.map((entry) => asRecord(entry))
    : []
  const assistantText = getAssistantTextPart(params.result.assistantEvent)
  const providerTimeline = params.providerChunks.map((chunk, index) => {
    const summary = summarizeProviderChunk(chunk)
    return {
      sequence: index + 1,
      ...summary,
    }
  })

  const audit = {
    test: params.name,
    provider: {
      totalChunks: params.providerChunks.length,
      chunkTypes: countBy(params.providerChunks, (chunk) => providerEventType(chunk) || "unknown"),
      response: {
        threadId: asString(output.threadId),
        turnId: asString(output.turnId),
        diffLength: asString(output.diff).length,
        assistantText,
        reasoningText: truncate(asString(output.reasoningText)),
        error: truncate(asString(asRecord(output.completedTurn).error || output.error)),
      },
      timeline: providerTimeline,
    },
    stream: {
      emittedChunks: streamPayloads.length,
      emittedChunkTypes: countBy(streamPayloads, (payload) => asString(payload.chunkType)),
      providerChunkTypes: countBy(streamPayloads, (payload) => asString(payload.providerChunkType)),
      timeline: streamPayloads.map((payload) => {
        const mapped = summarizeMappedPayload(payload)
        return {
          sequence: asNumber(payload.sequence),
          at: asString(payload.at),
          chunkType: asString(payload.chunkType),
          providerChunkType: asString(payload.providerChunkType),
          actionRef: asString(payload.actionRef),
          method: mapped.method,
          text: mapped.text,
          error: mapped.error,
        }
      }),
    },
    persisted: {
      streamTraceTotalChunks: asNumber(streamTrace.totalChunks),
      streamTraceChunkTypes: asRecord(streamTrace.chunkTypes),
      streamTraceProviderChunkTypes: asRecord(streamTrace.providerChunkTypes),
      streamTraceChunksStored: persistedChunks.length,
    },
    entities: {
      assistantEvent: {
        id: asString(params.result.assistantEvent.id),
        type: asString(params.result.assistantEvent.type),
        status: asString(params.result.assistantEvent.status),
        createdAt: asString(params.result.assistantEvent.createdAt),
        partTypes: (Array.isArray(params.result.assistantEvent.content?.parts)
          ? params.result.assistantEvent.content.parts
          : []
        ).map((part) => asString(asRecord(part).type)),
      },
    },
    llm: {
      provider: asString(params.result.llm?.provider),
      model: asString(params.result.llm?.model),
      promptTokens: asNumber(params.result.llm?.promptTokens),
      completionTokens: asNumber(params.result.llm?.completionTokens),
      totalTokens: asNumber(params.result.llm?.totalTokens),
      latencyMs: asNumber(params.result.llm?.latencyMs),
    },
  }

  // eslint-disable-next-line no-console
  console.log(`[codex-reactor-audit:${params.name}] ${JSON.stringify(audit, null, 2)}`)

  const auditFileTemplate = asString(process.env.CODEX_REACTOR_AUDIT_FILE).trim()
  if (auditFileTemplate) {
    const auditFilePath = auditFileTemplate.includes("{name}")
      ? auditFileTemplate.replaceAll("{name}", params.name)
      : auditFileTemplate
    mkdirSync(dirname(auditFilePath), { recursive: true })
    writeFileSync(auditFilePath, `${JSON.stringify(audit, null, 2)}\n`, "utf8")
  }

  return audit
}

async function executeRealTurnViaHttp(
  args: CodexExecuteTurnArgs<TestContext, CodexConfig, TestEnv>,
): Promise<{ turn: CodexTurnResult; providerChunks: Record<string, unknown>[] }> {
  const method = asString(process.env.CODEX_REACTOR_REAL_METHOD || "POST").toUpperCase()
  const extraHeadersRaw = asString(process.env.CODEX_REACTOR_REAL_HEADERS).trim()
  const extraHeaders = extraHeadersRaw ? asRecord(JSON.parse(extraHeadersRaw)) : {}

  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (!key) continue
    headers[key] = asString(value)
  }

  const requestBody = {
    instruction: args.instruction,
    config: args.config,
    context: args.context,
    triggerEvent: args.triggerEvent,
    runtime: {
      contextId: args.contextId,
      executionId: args.executionId,
      stepId: args.stepId,
      iteration: args.iteration,
    },
  }

  const response = await fetch(args.config.appServerUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(
      `Real provider call failed (${response.status}): ${response.statusText}${
        errorBody ? ` body=${errorBody}` : ""
      }`,
    )
  }

  const contentType = asString(response.headers.get("content-type")).toLowerCase()
  const providerChunks: Record<string, unknown>[] = []
  let finalPayload: Record<string, unknown> = {}

  if (contentType.includes("text/event-stream")) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error("Real provider returned empty SSE body.")
    const decoder = new TextDecoder()
    let buffer = ""
    let done = false
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
        try {
          const parsed = asRecord(JSON.parse(data))
          providerChunks.push(parsed)
          await args.emitChunk(parsed)
          if (asString(parsed.type).includes("finish")) {
            finalPayload = parsed
          }
        } catch {
          const synthetic = { type: "text_delta", text: data }
          providerChunks.push(synthetic)
          await args.emitChunk(synthetic)
        }
      }
    }
  } else {
    const payload = asRecord(await response.json())
    const streamArray = Array.isArray(payload.stream)
      ? payload.stream
      : Array.isArray(payload.chunks)
        ? payload.chunks
        : []
    for (const chunk of streamArray) {
      const parsed = asRecord(chunk)
      providerChunks.push(parsed)
      await args.emitChunk(parsed)
    }
    finalPayload = payload
  }

  const assistantTextFromChunks = providerChunks
    .map((chunk) => asString(chunk.text || chunk.delta))
    .filter((value) => value.length > 0)
    .join("")
    .trim()

  const assistantText = asString(
    finalPayload.assistantText ||
      finalPayload.outputText ||
      finalPayload.text ||
      assistantTextFromChunks ||
      "real-provider-response",
  )

  const turn: CodexTurnResult = {
    threadId: asString(finalPayload.threadId || args.config.threadId || "real-thread"),
    turnId: asString(finalPayload.turnId || finalPayload.id || `turn-${Date.now()}`),
    assistantText,
    reasoningText: asString(finalPayload.reasoningText || finalPayload.reasoning || ""),
    diff: asString(finalPayload.diff || ""),
    toolParts: Array.isArray(finalPayload.toolParts) ? finalPayload.toolParts : [],
    metadata: {
      providerResponse: finalPayload,
    },
    usage: asRecord(finalPayload.usage),
  }

  return { turn, providerChunks }
}

describe("createCodexReactor", () => {
  it("conversation continuity: same contextId + threadId across turns", async () => {
    const contextId = "ctx-continuity"
    const seededThreadId = "thr-continuity-001"
    const executeLog: Array<{ contextId: string; threadId: string; turnId: string }> = []
    let turn = 0

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      resolveConfig: async ({ env }) => ({
        appServerUrl: "http://127.0.0.1:3436",
        repoPath: "/workspace/repo",
        threadId: asString((env as TestEnv).threadId || seededThreadId) || seededThreadId,
        model: "openai/gpt-5.2-codex",
      }),
      executeTurn: async ({ config, contextId: callContextId, emitChunk }) => {
        turn += 1
        const threadId = asString(config.threadId || seededThreadId) || seededThreadId
        const turnId = `turn-cont-${turn}`
        executeLog.push({ contextId: callContextId, threadId, turnId })
        await emitChunk({ type: "start", turnId, threadId })
        await emitChunk({
          type: "text_delta",
          text: turn === 1 ? "First answer in thread." : "Second answer in same thread.",
          turnId,
          threadId,
        })
        await emitChunk({ type: "finish", finishReason: "stop", turnId, threadId })
        return {
          threadId,
          turnId,
          assistantText: turn === 1 ? "First answer in thread." : "Second answer in same thread.",
          reasoningText: "",
          diff: "",
          toolParts: [],
        }
      },
    })

    const firstCollected = collectWritableChunks()
    const firstResult = await reactor(
      createParams({
        writable: firstCollected.writable,
        contextId,
        threadId: seededThreadId,
        eventId: "evt-cont-1",
        executionId: "exe-cont-1",
        stepId: "step-cont-1",
      }),
    )
    const firstOutput = asRecord(getCodexEventPart(firstResult.assistantEvent).output)
    const firstThreadId = asString(firstOutput.threadId)

    const secondCollected = collectWritableChunks()
    const secondResult = await reactor(
      createParams({
        writable: secondCollected.writable,
        contextId,
        threadId: firstThreadId,
        eventId: "evt-cont-2",
        executionId: "exe-cont-2",
        stepId: "step-cont-2",
      }),
    )
    const secondOutput = asRecord(getCodexEventPart(secondResult.assistantEvent).output)
    const secondThreadId = asString(secondOutput.threadId)

    expect(firstThreadId).toBe(seededThreadId)
    expect(secondThreadId).toBe(firstThreadId)
    expect(executeLog).toHaveLength(2)
    expect(executeLog[0]?.contextId).toBe(contextId)
    expect(executeLog[1]?.contextId).toBe(contextId)
    expect(executeLog[0]?.threadId).toBe(seededThreadId)
    expect(executeLog[1]?.threadId).toBe(seededThreadId)
  })

  it("scripted provider stream audit: maps chunks, persists trace, and preserves provider response", async () => {
    const collected = collectWritableChunks()
    const providerChunks: Record<string, unknown>[] = [
      { type: "start" },
      { type: "reasoning_delta", delta: "Inspecting repository context..." },
      { type: "text_delta", text: "I inspected README.md." },
      {
        type: "action_input_available",
        actionName: "runCommand",
        toolCallId: "call_001",
      },
      { type: "action_output_available", toolCallId: "call_001", text: "Command done." },
      { type: "finish", finishReason: "stop" },
    ]

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      includeReasoningPart: true,
      resolveConfig: async () => ({
        appServerUrl: "http://127.0.0.1:3436",
        repoPath: "/workspace/repo",
        threadId: "thr-scripted",
        model: "openai/gpt-5.2-codex",
      }),
      executeTurn: async ({ emitChunk }) => {
        for (const chunk of providerChunks) {
          await emitChunk(chunk)
        }
        return {
          threadId: "thr-scripted",
          turnId: "turn-scripted-001",
          assistantText: "README explains the coding agent trace workflow.",
          reasoningText: "Read file and summarized key points.",
          diff: "",
          toolParts: [{ name: "runCommand", state: "output-available" }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 40 },
          },
          metadata: {
            providerRequestId: "req-scripted-001",
          },
        }
      },
    })

    const params = createParams({ writable: collected.writable })
    const result = await reactor(params)
    const audit = buildAudit({
      name: "scripted",
      providerChunks,
      written: collected.written,
      result,
    })

    expect(result.assistantEvent.type).toBe("output")
    expect(audit.provider.totalChunks).toBe(6)
    expect(audit.stream.emittedChunks).toBe(6)
    expect(audit.persisted.streamTraceTotalChunks).toBe(6)
    expect(audit.persisted.streamTraceChunkTypes).toMatchObject({
      "chunk.start": 1,
      "chunk.reasoning_delta": 1,
      "chunk.text_delta": 1,
      "chunk.action_input_available": 1,
      "chunk.action_output_available": 1,
      "chunk.finish": 1,
    })
    expect(audit.llm.promptTokens).toBe(120)
    expect(audit.llm.completionTokens).toBe(30)
    expect(audit.llm.totalTokens).toBe(150)
  })

  it("mocked provider stream audit: custom map, raw chunks, and hook telemetry", async () => {
    const collected = collectWritableChunks()
    const hookChunks: CodexMappedChunk[] = []
    const providerChunks: Record<string, unknown>[] = [
      { event: "start", id: "e1" },
      { event: "text_delta", id: "e2", message: "Drafting response..." },
      { event: "action_input_available", id: "e3", actionRef: "call_777" },
      { event: "finish", id: "e4", finishReason: "stop" },
    ]

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      includeRawProviderChunksInOutput: true,
      maxPersistedStreamChunks: 2,
      resolveConfig: async () => ({
        appServerUrl: "http://127.0.0.1:3436",
        repoPath: "/workspace/repo",
        threadId: "thr-mocked",
        model: "openai/gpt-5.2-codex",
      }),
      mapChunk: (providerChunk) => {
        const record = asRecord(providerChunk)
        const providerType = asString(record.event || record.type || "unknown")
        return {
          chunkType: mapCodexChunkType(providerType),
          providerChunkType: providerType,
          actionRef: asString(record.actionRef || record.id),
          data: {
            id: asString(record.id),
            message: asString(record.message),
          },
          raw: record,
        }
      },
      onMappedChunk: (chunk) => {
        hookChunks.push(chunk)
      },
      executeTurn: async ({ emitChunk }) => {
        for (const chunk of providerChunks) {
          await emitChunk(chunk)
        }
        return {
          threadId: "thr-mocked",
          turnId: "turn-mocked-001",
          assistantText: "Completed mocked provider stream.",
          usage: {
            promptTokens: 80,
            completionTokens: 20,
            totalTokens: 100,
            promptTokensCached: 10,
          },
          metadata: {
            providerRequestId: "req-mocked-001",
            responseFormat: "mocked-event-stream",
          },
        }
      },
    })

    const params = createParams({
      writable: collected.writable,
      contextId: "ctx-mocked",
      eventId: "evt-mocked",
      executionId: "exe-mocked",
      stepId: "step-mocked",
    })
    const result = await reactor(params)
    const audit = buildAudit({
      name: "mocked",
      providerChunks,
      written: collected.written,
      result,
    })

    expect(hookChunks).toHaveLength(4)
    expect(audit.stream.emittedChunks).toBe(4)
    expect(audit.persisted.streamTraceTotalChunks).toBe(4)
    expect(audit.persisted.streamTraceChunksStored).toBe(2)
    expect(audit.persisted.streamTraceProviderChunkTypes).toMatchObject({
      start: 1,
      text_delta: 1,
      action_input_available: 1,
      finish: 1,
    })
    expect(audit.llm.promptTokens).toBe(80)
    expect(audit.llm.completionTokens).toBe(20)
    expect(audit.llm.totalTokens).toBe(100)
  })

  it("scripted app-server notifications audit: maps typed notifications and ignores legacy codex/event", async () => {
    const collected = collectWritableChunks()
    const providerChunks: Record<string, unknown>[] = [
      {
        method: "turn/started",
        params: {
          threadId: "thr-typed",
          turn: { id: "turn-typed-001", status: "inProgress" },
        },
      },
      {
        method: "item/started",
        params: {
          threadId: "thr-typed",
          turnId: "turn-typed-001",
          item: { type: "agentMessage", id: "msg-typed-001", text: "" },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr-typed",
          turnId: "turn-typed-001",
          itemId: "msg-typed-001",
          delta: "typed-stream",
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "thr-typed",
          turnId: "turn-typed-001",
          item: { type: "agentMessage", id: "msg-typed-001", text: "typed-stream" },
        },
      },
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thr-typed",
          turnId: "turn-typed-001",
          tokenUsage: {
            total: { totalTokens: 20, inputTokens: 12, outputTokens: 8 },
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thr-typed",
          turn: { id: "turn-typed-001", status: "completed" },
        },
      },
      {
        method: "codex/event/agent_message_delta",
        params: {
          msg: { type: "agent_message_delta", delta: "should-not-emit" },
        },
      },
    ]

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      resolveConfig: async () => ({
        appServerUrl: "http://127.0.0.1:3436",
        repoPath: "/workspace/repo",
        threadId: "thr-typed",
        model: "openai/gpt-5.2-codex",
      }),
      executeTurn: async ({ emitChunk }) => {
        for (const chunk of providerChunks) {
          await emitChunk(chunk)
        }
        return {
          threadId: "thr-typed",
          turnId: "turn-typed-001",
          assistantText: "typed-stream",
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        }
      },
    })

    const params = createParams({
      writable: collected.writable,
      contextId: "ctx-typed",
      eventId: "evt-typed",
      executionId: "exe-typed",
      stepId: "step-typed",
    })
    const result = await reactor(params)
    const audit = buildAudit({
      name: "typed-notifications",
      providerChunks,
      written: collected.written,
      result,
    })

    expect(audit.stream.emittedChunkTypes).toMatchObject({
      "chunk.start": 1,
      "chunk.text_start": 1,
      "chunk.text_delta": 1,
      "chunk.text_end": 1,
      "chunk.response_metadata": 1,
      "chunk.finish": 1,
    })
    expect(audit.stream.providerChunkTypes).toMatchObject({
      "turn/started": 1,
      "item/started": 1,
      "item/agentMessage/delta": 1,
      "item/completed": 1,
      "thread/tokenUsage/updated": 1,
      "turn/completed": 1,
    })
    expect((audit.stream.providerChunkTypes as Record<string, number>)["codex/event/agent_message_delta"]).toBeUndefined()
  })

  it("typed userMessage notifications map to metadata, not action chunks", async () => {
    const collected = collectWritableChunks()
    const providerChunks: Record<string, unknown>[] = [
      {
        method: "turn/started",
        params: {
          threadId: "thr-typed-user",
          turn: { id: "turn-typed-user-001", status: "inProgress" },
        },
      },
      {
        method: "item/started",
        params: {
          threadId: "thr-typed-user",
          turnId: "turn-typed-user-001",
          item: { type: "userMessage", id: "msg-user-001", text: "hello" },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "thr-typed-user",
          turnId: "turn-typed-user-001",
          item: { type: "userMessage", id: "msg-user-001", text: "hello" },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thr-typed-user",
          turn: { id: "turn-typed-user-001", status: "completed" },
        },
      },
    ]

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      resolveConfig: async () => ({
        appServerUrl: "http://127.0.0.1:3436",
        repoPath: "/workspace/repo",
        threadId: "thr-typed-user",
        model: "openai/gpt-5.2-codex",
      }),
      executeTurn: async ({ emitChunk }) => {
        for (const chunk of providerChunks) {
          await emitChunk(chunk)
        }
        return {
          threadId: "thr-typed-user",
          turnId: "turn-typed-user-001",
          assistantText: "ok",
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
          },
        }
      },
    })

    const params = createParams({
      writable: collected.writable,
      contextId: "ctx-typed-user",
      eventId: "evt-typed-user",
      executionId: "exe-typed-user",
      stepId: "step-typed-user",
    })
    const result = await reactor(params)
    const audit = buildAudit({
      name: "typed-user-message",
      providerChunks,
      written: collected.written,
      result,
    })

    expect(audit.stream.emittedChunkTypes).toMatchObject({
      "chunk.start": 1,
      "chunk.message_metadata": 2,
      "chunk.finish": 1,
    })
    expect((audit.stream.emittedChunkTypes as Record<string, number>)["chunk.action_input_available"]).toBeUndefined()
    expect((audit.stream.emittedChunkTypes as Record<string, number>)["chunk.action_output_available"]).toBeUndefined()
  })

  const realProviderUrl = asString(process.env.CODEX_REACTOR_REAL_URL).trim()
  const realIt = realProviderUrl.length > 0 ? it : it.skip

  realIt("real provider stream audit: captures SSE/JSON stream and maps to thread chunks", async () => {
    const collected = collectWritableChunks()
    const providerChunks: Record<string, unknown>[] = []

    const reactor = createCodexReactor<TestContext, CodexConfig, TestEnv>({
      includeRawProviderChunksInOutput: true,
      resolveConfig: async () => ({
        appServerUrl: realProviderUrl,
        repoPath: asString(process.env.CODEX_REACTOR_REAL_REPO_PATH || process.cwd()),
        threadId: asString(process.env.CODEX_REACTOR_REAL_THREAD_ID || "thr-real"),
        model: asString(process.env.CODEX_REACTOR_REAL_MODEL || "").trim() || undefined,
      }),
      executeTurn: async (args) => {
        const executed = await executeRealTurnViaHttp(args)
        providerChunks.push(...executed.providerChunks)
        return executed.turn
      },
    })

    const params = createParams({
      writable: collected.writable,
      contextId: "ctx-real",
      eventId: "evt-real",
      executionId: "exe-real",
      stepId: "step-real",
    })

    const result = await reactor(params)
    const audit = buildAudit({
      name: "real",
      providerChunks,
      written: collected.written,
      result,
    })

    const providerTimeline = Array.isArray(audit.provider.timeline)
      ? (audit.provider.timeline as Array<Record<string, unknown>>)
      : []
    const hasUnauthorizedError = providerTimeline.some((entry) => {
      const errorText = asString(entry.error).toLowerCase()
      return errorText.includes("401") || errorText.includes("unauthorized") || errorText.includes("missing bearer")
    })

    expect(audit.provider.totalChunks).toBeGreaterThan(0)
    expect(audit.stream.emittedChunks).toBeGreaterThan(0)
    expect(audit.persisted.streamTraceTotalChunks).toBeGreaterThan(0)
    expect(asString(audit.provider.response.threadId)).not.toBe("")
    expect(asString(audit.provider.response.turnId)).not.toBe("")
    expect(hasUnauthorizedError).toBe(false)
  })
})

describe("defaultMapCodexChunk", () => {
  it("maps canonical provider chunk types to thread chunk types", () => {
    const mapped = [
      defaultMapCodexChunk({ type: "start" }),
      defaultMapCodexChunk({ type: "reasoning_delta", delta: "thinking" }),
      defaultMapCodexChunk({ type: "text_delta", text: "hello" }),
      defaultMapCodexChunk({ type: "action_input_available", toolCallId: "call-1" }),
      defaultMapCodexChunk({ type: "action_output_available", toolCallId: "call-1" }),
      defaultMapCodexChunk({ type: "finish", finishReason: "stop" }),
    ]

    expect(mapped.map((entry) => entry.chunkType)).toEqual([
      "chunk.start",
      "chunk.reasoning_delta",
      "chunk.text_delta",
      "chunk.action_input_available",
      "chunk.action_output_available",
      "chunk.finish",
    ])
  })
})
