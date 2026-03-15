/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { simulateReadableStream, tool, type UIMessageChunk } from "ai"
import { MockLanguageModelV2 } from "ai/test"
import { configureRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  createContext,
  didToolExecute,
  eventsDomain,
  type ContextItem,
} from "../index.ts"
import { describeInstant, itInstant, destroyContextTestApp, provisionContextTestApp } from "./_env.ts"
import { createStageTimer, writeBenchmarkReport } from "./_benchmark.ts"

type ContextTestEnv = {
  actorId: string
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

function createTriggerEvent(text: string): ContextItem {
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
    provider: "context-tests",
    modelId: "context-tests-ai-sdk-mock",
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
      },
      warnings: [],
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
          { type: "tool-input-start", id: "tc_set_status_1", toolName },
          { type: "tool-input-delta", id: "tc_set_status_1", delta: "{\"value\":\"ready\"}" },
          { type: "tool-input-end", id: "tc_set_status_1" },
          {
            type: "tool-call",
            toolCallId: "tc_set_status_1",
            toolName,
            input: JSON.stringify({ value: "ready" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: {
              inputTokens: 13,
              outputTokens: 21,
              totalTokens: 34,
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
    throw new Error("Context test runtime DB is not initialized.")
  }
  return db
}

describeInstant("context ai sdk reactor + ai/test mock model", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-ai-sdk-reactor-${Date.now()}`,
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

  itInstant("executes directly in non-durable mode and streams step chunks only", async () => {
    const timer = createStageTimer()
    const contextKey = `context-ai-sdk-context:${Date.now()}`
    const { chunks, writable } = createChunkCollector()

    const aiSdkContext = createContext<ContextTestEnv>("context.tests.ai-sdk-reactor")
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
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const result = await timer.measure("reactMs", async () =>
      await aiSdkContext.react(createTriggerEvent("set status to ready"), {
        env: {
          actorId: "user_context_tests",
        },
        context: { key: contextKey },
        durable: false,
        __benchmark: timer,
        options: {
          silent: false,
          maxIterations: 3,
          maxModelSteps: 1,
          writable: writable as WritableStream<UIMessageChunk>,
        },
      }),
    )

    expect(result.context.status).toBe("closed")
    expect(result.execution.status).toBe("completed")
    expect(result.reaction.status).toBe("completed")
    expect(chunks.length).toBeGreaterThan(0)

    const dataChunkTypes = chunks
      .map((chunk) => readString(chunk, "type"))
      .filter((type): type is string => Boolean(type))
    expect(dataChunkTypes.includes("data-chunk.emitted")).toBe(true)
    expect(dataChunkTypes.includes("data-step.created")).toBe(false)
    expect(dataChunkTypes.includes("data-execution.created")).toBe(false)

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_executions: {
          $: { where: { id: result.execution.id }, limit: 1 },
        },
        event_steps: {
          $: { where: { "execution.id": result.execution.id }, limit: 20 },
        },
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
      }),
    )
    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRows = readRows(snapshot, "event_steps")
    const itemRows = readRows(snapshot, "event_items")

    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(null)
    expect(stepRows.length).toBeGreaterThan(0)

    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
    expect(readString(reactionItem, "status")).toBe("completed")

    const timings = timer.snapshot()
    writeBenchmarkReport("context-ai-sdk-direct-report", {
      test: "context ai sdk reactor + ai/test mock model > executes directly in non-durable mode and streams step chunks only",
      mode: "direct",
      totalMs: timings.totalMs,
      stageTimingsMs: timings.stageTimingsMs,
      contextId: result.context.id,
      executionId: result.execution.id,
      chunksCount: chunks.length,
    })
  }, 5 * 60 * 1000)

  itInstant("persists tool output errors in non-durable mode", async () => {
    const timer = createStageTimer()
    const contextKey = `context-ai-sdk-error-context:${Date.now()}`

    const failingToolContext = createContext<ContextTestEnv>("context.tests.ai-sdk-reactor.error")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "AI SDK reactor mocked model tool-error test.")
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

    const result = await timer.measure("reactMs", async () =>
      await failingToolContext.react(createTriggerEvent("set status to ready"), {
        env: {
          actorId: "user_context_tests",
        },
        context: { key: contextKey },
        durable: false,
        __benchmark: timer,
        options: {
          silent: true,
          maxIterations: 2,
          maxModelSteps: 1,
        },
      }),
    )

    expect(result.execution.status).toBe("completed")
    expect(result.reaction.status).toBe("completed")

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
      }),
    )
    const itemRows = readRows(snapshot, "event_items")
    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
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

    const timings = timer.snapshot()
    writeBenchmarkReport("context-ai-sdk-direct-error-report", {
      test: "context ai sdk reactor + ai/test mock model > persists tool output errors in non-durable mode",
      mode: "direct",
      totalMs: timings.totalMs,
      stageTimingsMs: timings.stageTimingsMs,
      contextId: result.context.id,
      executionId: result.execution.id,
    })
  }, 5 * 60 * 1000)
})
