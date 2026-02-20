/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { simulateReadableStream, tool, type UIMessageChunk } from "ai"
import { MockLanguageModelV2 } from "ai/test"
import { configureRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

import {
  createAiSdkReactor,
  createThread,
  didToolExecute,
  parseThreadStreamEvent,
  threadDomain,
  THREAD_STREAM_CHUNK_TYPES,
  validateThreadStreamTimeline,
  type ThreadItem,
} from "../index.ts"
import { describeInstant, itInstant, destroyThreadTestApp, provisionThreadTestApp } from "./_env.ts"

type ThreadTestEnv = {
  actorId: string
  workflowRunId: string
}

type ReactorConfig = {
  modelInit: () => Promise<MockLanguageModelV2>
  maxModelSteps: number
}

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
  const delta = typeof chunk.delta === "string" ? chunk.delta : null
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
    partType: data ? readString(data, "partType") : null,
    partPreview: data ? readString(data, "partPreview") : null,
    textDelta: delta,
    toolName: readString(chunk, "toolName"),
    toolCallId: readString(chunk, "toolCallId") ?? readString(chunk, "id"),
    rawPreview: chunkPreviewSource ? clipText(chunkPreviewSource) : null,
  }
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
  const writable = new WritableStream<Record<string, unknown>>({
    write(chunk) {
      if (chunk && typeof chunk === "object") {
        chunks.push(chunk)
      }
    },
  })
  return { chunks, writable }
}

function createMockModel(toolName: string): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    provider: "thread-tests",
    modelId: "thread-tests-ai-sdk-mock",
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: "I will set status to ready.",
        },
        {
          type: "tool-call",
          toolCallId: "tc_set_status_1",
          toolName,
          input: JSON.stringify({ value: "ready" }),
        },
      ],
      finishReason: "tool-calls",
      usage: {
        inputTokens: 13,
        outputTokens: 21,
        totalTokens: 34,
        reasoningTokens: 5,
        cachedInputTokens: 2,
      },
      warnings: [],
      providerMetadata: {
        "thread-tests": {
          modelTier: "mock",
          promptCache: "enabled",
        },
      },
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text_1" },
          { type: "text-delta", id: "text_1", delta: "I will set status to ready." },
          { type: "text-end", id: "text_1" },
          { type: "reasoning-start", id: "reasoning_1" },
          {
            type: "reasoning-delta",
            id: "reasoning_1",
            delta: "Need deterministic tool call for status update.",
          },
          { type: "reasoning-end", id: "reasoning_1" },
          { type: "tool-input-start", id: "tc_set_status_1", toolName },
          { type: "tool-input-delta", id: "tc_set_status_1", delta: "{\"value\":\"re" },
          { type: "tool-input-delta", id: "tc_set_status_1", delta: "ady\"}" },
          { type: "tool-input-end", id: "tc_set_status_1" },
          {
            type: "tool-call",
            toolCallId: "tc_set_status_1",
            toolName,
            input: JSON.stringify({ value: "ready" }),
          },
          {
            type: "response-metadata",
            id: "resp_1",
            modelId: "thread-tests-ai-sdk-mock",
            timestamp: new Date(),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: {
              inputTokens: 13,
              outputTokens: 21,
              totalTokens: 34,
              reasoningTokens: 5,
              cachedInputTokens: 2,
            },
            providerMetadata: {
              "thread-tests": {
                modelTier: "mock",
                promptCache: "enabled",
              },
            },
          },
        ],
      }),
    }),
  })
}

let appId: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Thread test runtime DB is not initialized.")
  }
  return db
}

describeInstant("thread ai sdk reactor + ai/test mock model", () => {
  beforeAll(async () => {
    const schema = threadDomain.toInstantSchema()
    const app = await provisionThreadTestApp({
      name: `thread-ai-sdk-reactor-${Date.now()}`,
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
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyThreadTestApp(appId)
    }
  }, 5 * 60 * 1000)

  itInstant("supports configurable AI SDK reactor model selection with ai/test mocks", async () => {
    const workflowRunId = `thread-ai-sdk-run-${Date.now()}`
    const contextKey = `thread-ai-sdk-context:${workflowRunId}`

    const configuredModelInit = async () => createMockModel("set_status")
    let resolveConfigCalls = 0
    let selectModelCalls = 0
    let selectMaxModelStepsCalls = 0

    const aiSdkThread = createThread<ThreadTestEnv>("thread.tests.ai-sdk-reactor")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "AI SDK reactor mocked model test.")
      .actions(() => ({
        set_status: tool({
          description: "Apply deterministic status update.",
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => ({ ok: true, value }),
        }),
      }))
      .model(() => createMockModel("set_status"))
      .reactor(
        createAiSdkReactor<unknown, ThreadTestEnv, ReactorConfig>({
          resolveConfig: async () => {
            resolveConfigCalls += 1
            return { modelInit: configuredModelInit, maxModelSteps: 1 }
          },
          selectModel: async ({ config }) => {
            selectModelCalls += 1
            return config.modelInit
          },
          selectMaxModelSteps: async ({ config }) => {
            selectMaxModelStepsCalls += 1
            return config.maxModelSteps
          },
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const env: ThreadTestEnv = {
      actorId: "user_thread_tests",
      workflowRunId,
    }

    const result = await aiSdkThread.react(createTriggerEvent("set status to ready"), {
      env,
      context: { key: contextKey },
      options: {
        silent: true,
        maxIterations: 3,
        maxModelSteps: 1,
      },
    })

    expect(resolveConfigCalls).toBeGreaterThan(0)
    expect(selectModelCalls).toBeGreaterThan(0)
    expect(selectMaxModelStepsCalls).toBeGreaterThan(0)

    const snapshot = await currentDb().query({
      thread_threads: {
        $: { where: { key: contextKey }, limit: 1 },
      },
      thread_contexts: {
        $: { where: { id: result.contextId }, limit: 1 },
      },
      thread_executions: {
        $: { where: { id: result.executionId }, limit: 1 },
      },
      thread_steps: {
        $: { where: { "execution.id": result.executionId }, limit: 10 },
      },
      thread_items: {
        $: { where: { "context.id": result.contextId }, limit: 20 },
      },
    })

    const threadRow = readRows(snapshot, "thread_threads")[0]
    const contextRow = readRows(snapshot, "thread_contexts")[0]
    const executionRow = readRows(snapshot, "thread_executions")[0]
    const stepRow = readRows(snapshot, "thread_steps")[0]
    const itemRows = readRows(snapshot, "thread_items")

    expect(readString(threadRow, "status")).toBe("idle")
    expect(readString(contextRow, "status")).toBe("closed")
    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(workflowRunId)
    expect(readString(stepRow, "status")).toBe("completed")
    expect(stepRow?.continueLoop).toBe(false)

    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reactionEventId)
    expect(readString(reactionItem, "status")).toBe("completed")

    const reactionContent = asRecord(reactionItem?.content)
    const reactionParts = Array.isArray(reactionContent?.parts)
      ? reactionContent.parts
      : []
    const hasToolOutput = reactionParts.some((part) => {
      const row = asRecord(part)
      if (!row) return false
      return row.type === "tool-set_status" && row.state === "output-available"
    })
    expect(hasToolOutput).toBe(true)

  }, 5 * 60 * 1000)

  itInstant("emits explicit lifecycle chunks with ai/test mocked model", async () => {
    const workflowRunId = `thread-ai-sdk-stream-run-${Date.now()}`
    const contextKey = `thread-ai-sdk-stream-context:${workflowRunId}`
    const { chunks, writable } = createChunkCollector()

    const streamingThread = createThread<ThreadTestEnv>("thread.tests.ai-sdk-reactor.stream")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "AI SDK reactor mocked model stream contract test.")
      .actions(() => ({
        set_status: tool({
          description: "Apply deterministic status update.",
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => ({ ok: true, value }),
        }),
      }))
      .model(() => createMockModel("set_status"))
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const result = await streamingThread.react(createTriggerEvent("set status to ready"), {
      env: {
        actorId: "user_thread_tests",
        workflowRunId,
      },
      context: { key: contextKey },
      options: {
        silent: false,
        maxIterations: 3,
        maxModelSteps: 1,
        writable: writable as WritableStream<UIMessageChunk>,
      },
    })

    expect(chunks.length).toBeGreaterThan(0)
    const streamEventTypes = chunks
      .map((chunk) => readString(chunk, "type"))
      .filter((type): type is string => Boolean(type))
    expect(streamEventTypes.includes("data-context.created")).toBe(true)
    expect(streamEventTypes.includes("data-execution.created")).toBe(true)
    expect(streamEventTypes.includes("data-step.created")).toBe(true)
    expect(streamEventTypes.includes("data-step.updated")).toBe(true)
    expect(streamEventTypes.includes("data-step.completed")).toBe(true)
    expect(streamEventTypes.includes("data-item.created")).toBe(true)
    expect(streamEventTypes.includes("data-item.completed")).toBe(true)
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
    expect(canonicalChunkTypes.includes("chunk.start_step")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.text_delta")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.reasoning_start")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.reasoning_delta")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.action_input_start")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.action_input_delta")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.action_input_available")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.finish_step")).toBe(true)
    expect(canonicalChunkTypes.includes("chunk.finish")).toBe(true)

    const snapshot = await currentDb().query({
      thread_executions: {
        $: { where: { id: result.executionId }, limit: 1 },
      },
      thread_steps: {
        $: { where: { "execution.id": result.executionId }, limit: 20 },
      },
      thread_items: {
        $: { where: { "context.id": result.contextId }, limit: 50 },
      },
    })
    const executionRow = readRows(snapshot, "thread_executions")[0]
    const stepRows = readRows(snapshot, "thread_steps")
    const itemRows = readRows(snapshot, "thread_items")
    const usageChunk = chunks
      .map((chunk) => asRecord(chunk))
      .find((chunk) => chunk?.type === "finish")
    const usage = usageChunk ? asRecord(usageChunk.usage) : null

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

    const entityTimeline = [
      ...stepRows.map((row) => ({
        entity: "step",
        id: readString(row, "id"),
        iteration: readNumber(row, "iteration"),
        kind: readString(row, "kind"),
        status: readString(row, "status"),
        actionName: readString(row, "actionName"),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      ...itemRows.map((row) => ({
        entity: "item",
        id: readString(row, "id"),
        type: readString(row, "type"),
        status: readString(row, "status"),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
    ].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))

    const report = {
      test: "thread.ai-sdk-reactor.instant.test.ts",
      mode: "mocked",
      model: "thread-tests-ai-sdk-mock",
      workflowRunId,
      executionId: result.executionId,
      contextId: result.contextId,
      reactionEventId: result.reactionEventId,
      usage,
      streamTimeline,
      mappingSummary,
      unknownChunkCount,
      hasSequenceGap,
      entityTimeline,
      execution: executionRow,
    }
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `thread-ai-sdk-mock-report-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    // eslint-disable-next-line no-console
    console.log(`[thread-mock-test-report] ${reportPath}`)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2))
  }, 5 * 60 * 1000)

  itInstant("emits explicit step/item lifecycle when action execution fails", async () => {
    const workflowRunId = `thread-ai-sdk-error-run-${Date.now()}`
    const contextKey = `thread-ai-sdk-error-context:${workflowRunId}`
    const { chunks, writable } = createChunkCollector()

    const failingToolThread = createThread<ThreadTestEnv>("thread.tests.ai-sdk-reactor.error")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "AI SDK reactor mocked model tool-error stream contract test.")
      .actions(() => ({
        set_status: tool({
          description: "Failing deterministic status update.",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            throw new Error("set_status_failed")
          },
        }),
      }))
      .model(() => createMockModel("set_status"))
      .shouldContinue(() => false)
      .build()

    const result = await failingToolThread.react(createTriggerEvent("set status to ready"), {
      env: {
        actorId: "user_thread_tests",
        workflowRunId,
      },
      context: { key: contextKey },
      options: {
        silent: false,
        maxIterations: 2,
        maxModelSteps: 1,
        writable: writable as WritableStream<UIMessageChunk>,
      },
    })

    expect(chunks.length).toBeGreaterThan(0)
    const streamEventTypes = chunks
      .map((chunk) => readString(chunk, "type"))
      .filter((type): type is string => Boolean(type))

    expect(streamEventTypes.length).toBeGreaterThan(0)
    expect(streamEventTypes[0]).toBe("data-context.created")
    expect(streamEventTypes.includes("data-step.updated")).toBe(true)
    expect(streamEventTypes.includes("data-item.completed")).toBe(true)
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
    expect(canonicalChunkTypes.includes("chunk.action_input_available")).toBe(true)

    const snapshot = await currentDb().query({
      thread_executions: {
        $: { where: { id: result.executionId }, limit: 1 },
      },
      thread_items: {
        $: { where: { "context.id": result.contextId }, limit: 20 },
      },
    })
    const executionRow = readRows(snapshot, "thread_executions")[0]
    expect(readString(executionRow, "status")).toBe("completed")

    const itemRows = readRows(snapshot, "thread_items")
    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reactionEventId)
    expect(reactionItem).toBeTruthy()
    const reactionContent = asRecord(reactionItem?.content)
    const reactionParts = Array.isArray(reactionContent?.parts)
      ? reactionContent.parts
      : []
    const hasToolErrorOutput = reactionParts.some((part) => {
      const row = asRecord(part)
      if (!row) return false
      return row.type === "tool-set_status" && row.state === "output-error"
    })
    expect(hasToolErrorOutput).toBe(true)
  }, 5 * 60 * 1000)
})
