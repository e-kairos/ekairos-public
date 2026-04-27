/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { simulateReadableStream, tool, type UIMessageChunk } from "ai"
import { MockLanguageModelV2 } from "ai/test"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  createContext,
  didToolExecute,
  eventsDomain,
  type ContextItem,
} from "../index.ts"
import { readPersistedContextStepStream } from "../runtime.ts"
import { describeInstant, itInstant, destroyContextTestApp, provisionContextTestApp } from "./_env.ts"
import { createStageTimer, writeBenchmarkReport } from "./_benchmark.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

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
let adminToken: string | null = null
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
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
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
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      actorId: "user_context_tests",
    })

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

    const shell = await timer.measure("reactShellMs", async () =>
      await aiSdkContext.react(createTriggerEvent("set status to ready"), {
        runtime,
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

    expect(shell.context.status).toBe("open_streaming")
    expect(shell.reaction.status).toBe("pending")
    expect(shell.execution.status).toBe("executing")
    expect(shell.run).toBeInstanceOf(Promise)

    const result = await timer.measure("reactRunMs", async () => await shell.run!)

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

    // Given a non-durable reaction that still creates a persisted step stream,
    // when we replay the raw Instant stream, then reconstructable part chunks
    // must carry the same deterministic part identity that live clients receive.
    const streamStep = stepRows.find(
      (row) => readString(row, "streamClientId") || readString(row, "streamId"),
    )
    expect(streamStep).toBeTruthy()
    const persistedStream = await timer.measure("persistedStreamReadMs", async () =>
      await readPersistedContextStepStream({
        db: currentDb(),
        clientId: readString(streamStep, "streamClientId") ?? undefined,
        streamId: readString(streamStep, "streamId") ?? undefined,
      }),
    )
    const partChunks = persistedStream.chunks.filter((chunk) => chunk.partId)
    expect(partChunks.length).toBeGreaterThan(0)

    const textChunks = partChunks.filter(
      (chunk) => chunk.providerPartId === "text_1",
    )
    expect(textChunks.length).toBeGreaterThan(0)
    expect(new Set(textChunks.map((chunk) => chunk.partId)).size).toBe(1)
    for (const chunk of textChunks) {
      expect(chunk.partType).toBe("message")
      expect(chunk.partSlot).toBe("message")
    }

    const actionChunks = partChunks.filter(
      (chunk) => chunk.providerPartId === "tc_set_status_1",
    )
    expect(actionChunks.length).toBeGreaterThan(0)
    expect(actionChunks.some((chunk) => chunk.partType === "action")).toBe(true)
    expect(
      actionChunks.every((chunk) => chunk.actionRef === "tc_set_status_1"),
    ).toBe(true)

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
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      actorId: "user_context_tests",
    })

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

    const shell = await timer.measure("reactShellMs", async () =>
      await failingToolContext.react(createTriggerEvent("set status to ready"), {
        runtime,
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
    const result = await timer.measure("reactRunMs", async () => await shell.run!)

    expect(result.execution.status).toBe("completed")
    expect(result.reaction.status).toBe("completed")

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
        event_steps: {
          $: { where: { "execution.id": result.execution.id }, limit: 10 },
        },
      }),
    )
    const itemRows = readRows(snapshot, "event_items")
    const stepRows = readRows(snapshot, "event_steps")
    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
    expect(reactionItem).toBeTruthy()
    const stepId = readString(stepRows[0], "id")
    expect(stepId).toBeTruthy()
    const partsSnapshot = await currentDb().query({
      event_parts: {
        $: {
          where: { stepId: stepId as any },
          limit: 50,
          order: { idx: "asc" },
        },
      },
    })
    const partRows = readRows(partsSnapshot, "event_parts")
    const hasToolErrorOutput = partRows.some((row) => {
      const part = asRecord(row.part)
      if (!part) return false
      const content = asRecord(part.content)
      return (
        (part.type === "tool-result" && part.state === "output-error") ||
        (part.type === "action" &&
          content?.status === "failed" &&
          content?.actionName === "set_status")
      )
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
