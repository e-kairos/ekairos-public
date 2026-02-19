/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { simulateReadableStream, tool, type UIMessageChunk } from "ai"
import { MockLanguageModelV2 } from "ai/test"
import { configureRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  createAiSdkReactor,
  createThread,
  didToolExecute,
  threadDomain,
  THREAD_STREAM_CHUNK_TYPES,
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

function createTriggerEvent(text: string): ThreadItem {
  return {
    id: randomUUID(),
    type: "input_text",
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
          type: "tool-call",
          toolCallId: "tc_set_status_1",
          toolName,
          input: JSON.stringify({ value: "ready" }),
        },
      ],
      finishReason: "tool-calls",
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "tc_set_status_1",
            toolName,
            input: JSON.stringify({ value: "ready" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
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
        $: { where: { executionId: result.executionId }, limit: 10 },
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

    expect(readString(threadRow, "status")).toBe("open")
    expect(readString(contextRow, "status")).toBe("open")
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

  itInstant("emits thread custom chunk contract with ai/test mocked model", async () => {
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

    await streamingThread.react(createTriggerEvent("set status to ready"), {
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
    const allowedCustomChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[])
    const customChunkTypes = chunks
      .map((chunk) => {
        const type = chunk.type
        return typeof type === "string" && allowedCustomChunkTypes.has(type) ? type : null
      })
      .filter((type): type is string => Boolean(type))

    expect(customChunkTypes.length).toBeGreaterThan(0)
    expect(customChunkTypes[0]).toBe("data-context-id")
    expect(customChunkTypes.includes("tool-output-available")).toBe(true)
    expect(customChunkTypes.includes("tool-output-error")).toBe(false)
    expect(customChunkTypes[customChunkTypes.length - 1]).toBe("finish")
  }, 5 * 60 * 1000)

  itInstant("emits tool-output-error chunk when tool execution fails", async () => {
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
    const allowedCustomChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[])
    const customChunkTypes = chunks
      .map((chunk) => {
        const type = chunk.type
        return typeof type === "string" && allowedCustomChunkTypes.has(type) ? type : null
      })
      .filter((type): type is string => Boolean(type))

    expect(customChunkTypes.length).toBeGreaterThan(0)
    expect(customChunkTypes[0]).toBe("data-context-id")
    expect(customChunkTypes.includes("tool-output-error")).toBe(true)
    expect(customChunkTypes[customChunkTypes.length - 1]).toBe("finish")

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
