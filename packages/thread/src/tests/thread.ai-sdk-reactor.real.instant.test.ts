/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { tool, type UIMessageChunk } from "ai"
import { configureRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

import {
  createThread,
  didToolExecute,
  parseThreadStreamEvent,
  threadDomain,
  THREAD_STREAM_CHUNK_TYPES,
  validateThreadStreamTimeline,
  type ThreadItem,
} from "../index.ts"
import {
  destroyThreadTestApp,
  hasInstantProvisionToken,
  provisionThreadTestApp,
} from "./_env.ts"

type ThreadTestEnv = {
  actorId: string
  workflowRunId: string
}

const REAL_MODEL = String(process.env.THREAD_AI_SDK_REAL_MODEL ?? "openai/gpt-5.2-codex").trim()
const hasAiGatewayApiKey = Boolean(String(process.env.AI_GATEWAY_API_KEY ?? "").trim())
const hasRealModelTestEnv = hasInstantProvisionToken() && hasAiGatewayApiKey

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  if (!root) return []
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

function readNumber(row: Record<string, unknown> | undefined, key: string): number | null {
  if (!row) return null
  const value = row[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function createTriggerEvent(text: string): ThreadItem {
  return {
    id: randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

function createChunkCollector() {
  const chunks: Record<string, unknown>[] = []
  const writable = new WritableStream<UIMessageChunk>({
    write(chunk) {
      const row = asRecord(chunk)
      if (row) chunks.push(row)
    },
  })
  return { chunks, writable }
}

function toIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

function clipText(value: string, max = 240): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

function summarizeChunkForTimeline(chunk: Record<string, unknown>, index: number) {
  const type = typeof chunk.type === "string" ? chunk.type : "unknown"
  const data = asRecord(chunk.data)
  const delta = readString(chunk, "delta")
  const text = readString(chunk, "text")
  const chunkPreviewSource = data
    ? JSON.stringify(data)
    : JSON.stringify(
        Object.fromEntries(
          Object.entries(chunk).filter(([key]) => !["type", "id", "data"].includes(key)),
        ),
      )

  return {
    index,
    chunkType: type,
    eventType: data ? readString(data, "type") : null,
    canonicalChunkType: data ? readString(data, "chunkType") : null,
    providerChunkType: data ? readString(data, "providerChunkType") : null,
    sequence: data ? readNumber(data, "sequence") : null,
    at: data ? readString(data, "at") : null,
    status: data ? readString(data, "status") : null,
    stepId: data ? readString(data, "stepId") : null,
    itemId: data ? readString(data, "itemId") : null,
    executionId: data ? readString(data, "executionId") : null,
    kind: data ? readString(data, "kind") : null,
    actionName: data ? readString(data, "actionName") : null,
    itemType: data ? readString(data, "itemType") : null,
    partType: data ? readString(data, "partType") : null,
    partPreview: data ? readString(data, "partPreview") : null,
    partState: data ? readString(data, "partState") : null,
    partToolCallId: data ? readString(data, "partToolCallId") : null,
    text,
    textDelta: delta,
    toolName: readString(chunk, "toolName"),
    toolCallId: readString(chunk, "toolCallId") ?? readString(chunk, "id"),
    finishReason: readString(chunk, "finishReason"),
    rawPreview: chunkPreviewSource ? clipText(chunkPreviewSource) : null,
  }
}

function collectObjects(value: unknown, out: Record<string, unknown>[], depth = 0) {
  if (!value || depth > 4) return
  if (Array.isArray(value)) {
    for (const entry of value) collectObjects(entry, out, depth + 1)
    return
  }
  if (typeof value !== "object") return
  const row = value as Record<string, unknown>
  out.push(row)
  for (const entry of Object.values(row)) {
    collectObjects(entry, out, depth + 1)
  }
}

function extractUsageFromChunks(chunks: Record<string, unknown>[]) {
  const usageCandidates: Array<Record<string, unknown>> = []
  for (const chunk of chunks) {
    const objects: Record<string, unknown>[] = []
    collectObjects(chunk, objects)
    for (const row of objects) {
      const promptTokens =
        readNumber(row, "promptTokens") ??
        readNumber(row, "inputTokens") ??
        readNumber(row, "prompt_tokens")
      const completionTokens =
        readNumber(row, "completionTokens") ??
        readNumber(row, "outputTokens") ??
        readNumber(row, "completion_tokens")
      const totalTokens = readNumber(row, "totalTokens") ?? readNumber(row, "total_tokens")
      const hasAnyTokenMetric =
        promptTokens !== null || completionTokens !== null || totalTokens !== null
      if (!hasAnyTokenMetric) continue
      usageCandidates.push({
        promptTokens,
        completionTokens,
        totalTokens,
        model:
          (readString(row, "model") ??
            readString(row, "modelId") ??
            readString(row, "aiModel")) ??
          undefined,
        provider:
          (readString(row, "provider") ??
            readString(row, "providerId") ??
            readString(row, "aiProvider")) ??
          undefined,
      })
    }
  }
  return usageCandidates.length > 0 ? usageCandidates[usageCandidates.length - 1] : null
}

let appId: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Thread test runtime DB is not initialized.")
  }
  return db
}

const describeRealInstant = hasRealModelTestEnv ? describe : describe.skip
const itRealInstant = hasRealModelTestEnv ? it : it.skip

describeRealInstant("thread ai sdk reactor + real AI Gateway model", () => {
  beforeAll(async () => {
    const schema = threadDomain.toInstantSchema()
    const app = await provisionThreadTestApp({
      name: `thread-ai-sdk-reactor-real-${Date.now()}`,
      schema,
    })

    appId = app.appId
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
    })

    configureRuntime({
      domain: { domain: threadDomain },
      runtime: async () => ({ db: currentDb() }),
    })
  }, 10 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyThreadTestApp(appId)
    }
  }, 10 * 60 * 1000)

  itRealInstant("executes a real model, persists lifecycle state, and records llm usage traces", async () => {
    const startedAtMs = Date.now()
    const workflowRunId = `thread-ai-sdk-real-run-${Date.now()}`
    const contextKey = `thread-ai-sdk-real-context:${workflowRunId}`
    const { chunks, writable } = createChunkCollector()

    const realThread = createThread<ThreadTestEnv>("thread.tests.ai-sdk-reactor.real")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(
        () =>
          "Call action set_status exactly once. Use value 'ready'. Do not call any other actions.",
      )
      .actions(() => ({
        set_status: tool({
          description: "Set deterministic status for integration validation.",
          inputSchema: z.object({ value: z.string().min(1) }),
          execute: async ({ value }) => ({ ok: true, value }),
        }),
      }))
      .model(REAL_MODEL)
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const result = await realThread.react(createTriggerEvent("set status to ready"), {
      env: {
        actorId: "user_thread_tests_real",
        workflowRunId,
      },
      context: { key: contextKey },
      options: {
        silent: false,
        maxIterations: 3,
        maxModelSteps: 1,
        writable,
      },
    })
    const finishedAtMs = Date.now()

    const snapshot = await currentDb().query({
      thread_executions: {
        $: { where: { id: result.executionId }, limit: 1 },
      },
      thread_steps: {
        $: { where: { "execution.id": result.executionId }, limit: 10 },
      },
      thread_items: {
        $: { where: { "context.id": result.contextId }, limit: 20 },
      },
      thread_trace_events: {
        $: { limit: 500 },
      },
    })

    const executionRow = readRows(snapshot, "thread_executions")[0]
    const stepRows = readRows(snapshot, "thread_steps")
    const itemRows = readRows(snapshot, "thread_items")
    const traceRows = readRows(snapshot, "thread_trace_events")

    type EntityTimelineRow = {
      entity: "item" | "step"
      id: string | null
      type?: string | null
      iteration?: number | null
      kind?: string | null
      status: string | null
      actionName?: string | null
      createdAt: string | null
      updatedAt: string | null
    }

    const itemTimeline = itemRows
      .map((row): EntityTimelineRow => ({
        entity: "item",
        id: readString(row, "id"),
        type: readString(row, "type"),
        status: readString(row, "status"),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }))
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    const stepTimeline = stepRows
      .map((row): EntityTimelineRow => ({
        entity: "step",
        id: readString(row, "id"),
        iteration: readNumber(row, "iteration"),
        kind: readString(row, "kind"),
        status: readString(row, "status"),
        actionName: readString(row, "actionName"),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }))
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))

    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(workflowRunId)
    expect(stepRows.length).toBeGreaterThan(0)

    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reactionEventId)
    expect(reactionItem).toBeTruthy()
    expect(readString(reactionItem, "status")).toBe("completed")

    const reactionContent = asRecord(reactionItem?.content)
    const reactionParts = Array.isArray(reactionContent?.parts) ? reactionContent.parts : []
    const hasToolOutput = reactionParts.some((part) => {
      const row = asRecord(part)
      if (!row) return false
      return row.type === "tool-set_status" && row.state === "output-available"
    })
    expect(hasToolOutput).toBe(true)

    const streamEventTypes = chunks
      .map((chunk) => readString(chunk, "type"))
      .filter((type): type is string => Boolean(type))
    const streamTimeline = chunks
      .map((chunk) => asRecord(chunk))
      .filter((chunk): chunk is Record<string, unknown> => Boolean(chunk))
      .map((chunk, index) => summarizeChunkForTimeline(chunk, index))

    const parsedEvents = chunks
      .map((chunk) => asRecord(chunk))
      .filter((chunk): chunk is Record<string, unknown> => Boolean(chunk))
      .filter((chunk) => {
        const type = readString(chunk, "type")
        return Boolean(type && type.startsWith("data-") && type !== "finish")
      })
      .map((chunk) => parseThreadStreamEvent(chunk.data))
    validateThreadStreamTimeline(parsedEvents)

    expect(streamEventTypes.length).toBeGreaterThan(0)
    expect(streamEventTypes.includes("data-execution.created")).toBe(true)
    expect(streamEventTypes.includes("data-step.created")).toBe(true)
    expect(streamEventTypes.includes("data-step.completed")).toBe(true)
    expect(streamEventTypes[streamEventTypes.length - 1]).toBe("finish")

    const allowedChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[])
    const canonicalChunkTypes = chunks
      .map((chunk) => {
        if (readString(chunk, "type") !== "data-chunk.emitted") return null
        const data = asRecord(chunk.data)
        const chunkType = data ? readString(data, "chunkType") : null
        return chunkType && allowedChunkTypes.has(chunkType) ? chunkType : null
      })
      .filter((type): type is string => Boolean(type))

    expect(canonicalChunkTypes.length).toBeGreaterThan(0)
    expect(canonicalChunkTypes.includes("chunk.start")).toBe(true)
    const hasSemanticPayloadChunk =
      canonicalChunkTypes.includes("chunk.text_delta") ||
      canonicalChunkTypes.includes("chunk.reasoning_delta") ||
      canonicalChunkTypes.includes("chunk.action_input_delta") ||
      canonicalChunkTypes.includes("chunk.action_input_available")
    expect(hasSemanticPayloadChunk).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.finish")).toBe(true)

    const mappedRows = streamTimeline.filter((row) => row.chunkType === "data-chunk.emitted")
    const sequenceValues = mappedRows
      .map((row) => row.sequence)
      .filter((value): value is number => typeof value === "number")
    const hasSequenceGap = sequenceValues.some((value, index) =>
      index > 0 ? value !== sequenceValues[index - 1] + 1 : false,
    )
    expect(hasSequenceGap).toBe(false)

    const unknownChunkCount = mappedRows.filter(
      (row) => row.canonicalChunkType === "chunk.unknown",
    ).length
    const mappingSummary = mappedRows.reduce<Record<string, number>>((acc, row) => {
      const providerChunkType = row.providerChunkType ?? "unknown-provider"
      const canonicalChunkType = row.canonicalChunkType ?? "unknown-canonical"
      const key = `${providerChunkType}->${canonicalChunkType}`
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})

    const traceRunCounts = traceRows.reduce<Record<string, number>>((acc, row) => {
      const runId = readString(row, "workflowRunId") ?? "unknown"
      acc[runId] = (acc[runId] ?? 0) + 1
      return acc
    }, {})
    const llmTraceEvents = traceRows.filter((row) => readString(row, "eventKind") === "thread.llm")
    const lastLlmTrace = llmTraceEvents.length > 0 ? llmTraceEvents[llmTraceEvents.length - 1] : null
    const expectedProvider = REAL_MODEL.includes("/") ? REAL_MODEL.split("/")[0] : null
    const expectedModel = REAL_MODEL.includes("/") ? REAL_MODEL.split("/").slice(1).join("/") : null
    if (lastLlmTrace && expectedProvider) {
      expect(readString(lastLlmTrace, "aiProvider")).toBe(expectedProvider)
    }
    if (lastLlmTrace && expectedModel) {
      expect(readString(lastLlmTrace, "aiModel")).toBe(expectedModel)
    }

    const usageFromTrace = lastLlmTrace
      ? {
          provider: readString(lastLlmTrace, "aiProvider"),
          model: readString(lastLlmTrace, "aiModel"),
          promptTokens: readNumber(lastLlmTrace, "promptTokens"),
          completionTokens: readNumber(lastLlmTrace, "completionTokens"),
          totalTokens: readNumber(lastLlmTrace, "totalTokens"),
          latencyMs: readNumber(lastLlmTrace, "latencyMs"),
          payload: asRecord(lastLlmTrace.payload),
        }
      : null
    const usageFromChunks = extractUsageFromChunks(chunks)
    const hasUsageMetrics =
      usageFromTrace?.promptTokens !== null ||
      usageFromTrace?.completionTokens !== null ||
      usageFromTrace?.totalTokens !== null ||
      usageFromChunks !== null
    expect(hasUsageMetrics).toBe(true)

    const report = {
      test: "thread.ai-sdk-reactor.real.instant.test.ts",
      model: REAL_MODEL,
      appId,
      workflowRunId,
      executionId: result.executionId,
      contextId: result.contextId,
      reactionEventId: result.reactionEventId,
      runtimeMs: finishedAtMs - startedAtMs,
      usage: {
        trace: usageFromTrace,
        chunks: usageFromChunks,
      },
      traceEventCount: traceRows.length,
      traceRunCounts,
      llmTraceEventCount: llmTraceEvents.length,
      streamTimeline,
      mappingSummary,
      unknownChunkCount,
      hasSequenceGap,
      entityTimeline: [...stepTimeline, ...itemTimeline].sort((a, b) =>
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      ),
    }

    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `thread-ai-sdk-real-report-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    // eslint-disable-next-line no-console
    console.log(`[thread-real-test-report] ${reportPath}`)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2))
  }, 10 * 60 * 1000)
})
