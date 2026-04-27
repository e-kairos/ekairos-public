/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { tool, type UIMessageChunk } from "ai"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  createContext,
  didToolExecute,
  eventsDomain,
  type ContextItem,
} from "../index.ts"
import {
  destroyContextTestApp,
  hasInstantProvisionToken,
  provisionContextTestApp,
} from "./_env.ts"
import { createStageTimer, writeBenchmarkReport } from "./_benchmark.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

type ContextTestEnv = {
  actorId: string
}

const REAL_MODEL = String(process.env.CONTEXT_AI_SDK_REAL_MODEL ?? "openai/gpt-5.4-nano").trim()
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
  const writable = new WritableStream<UIMessageChunk>({
    write(chunk) {
      const row = asRecord(chunk)
      if (row) chunks.push(row)
    },
  })
  return { chunks, writable }
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

const describeRealInstant = hasRealModelTestEnv ? describe : describe.skip
const itRealInstant = hasRealModelTestEnv ? it : it.skip

describeRealInstant("context ai sdk reactor + real AI Gateway model", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-ai-sdk-reactor-real-${Date.now()}`,
      schema,
    })

    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
    })
  }, 10 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 10 * 60 * 1000)

  itRealInstant("executes a real model directly in non-durable mode and persists final state", async () => {
    const timer = createStageTimer()
    const contextKey = `context-ai-sdk-real-context:${Date.now()}`
    const { chunks, writable } = createChunkCollector()
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      actorId: "user_context_tests_real",
    })

    const realContext = createContext<ContextTestEnv>("context.tests.ai-sdk-reactor.real")
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

    const shell = await timer.measure("reactShellMs", async () =>
      await realContext.react(createTriggerEvent("set status to ready"), {
        runtime,
        context: { key: contextKey },
        durable: false,
        __benchmark: timer,
        options: {
          silent: false,
          maxIterations: 3,
          maxModelSteps: 1,
          writable,
        },
      }),
    )
    const result = await timer.measure("reactRunMs", async () => await shell.run!)

    expect(result.context.status).toBe("closed")
    expect(result.execution.status).toBe("completed")
    expect(result.reaction.status).toBe("completed")

    const dataChunkTypes = chunks
      .map((chunk) => readString(chunk, "type"))
      .filter((type): type is string => Boolean(type))
    expect(dataChunkTypes.includes("data-chunk.emitted")).toBe(true)
    expect(dataChunkTypes.includes("data-execution.created")).toBe(false)

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_executions: {
          $: { where: { id: result.execution.id }, limit: 1 },
        },
        event_steps: {
          $: { where: { "execution.id": result.execution.id }, limit: 10 },
        },
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
        event_trace_events: {
          $: { limit: 500 },
        },
      }),
    )

    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRows = readRows(snapshot, "event_steps")
    const itemRows = readRows(snapshot, "event_items")
    const traceRows = readRows(snapshot, "event_trace_events")

    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(null)
    expect(stepRows.length).toBeGreaterThan(0)

    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
    expect(reactionItem).toBeTruthy()
    expect(readString(reactionItem, "status")).toBe("completed")

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

    const hasToolOutput = partRows.some((row) => {
      const part = asRecord(row.part)
      if (!part) return false
      const content = asRecord(part.content)
      return (
        (part.type === "tool-result" && part.state === "output-available") ||
        (part.type === "action" &&
          content?.status === "completed" &&
          content?.actionName === "set_status")
      )
    })
    expect(hasToolOutput).toBe(true)

    expect(Array.isArray(traceRows)).toBe(true)

    const timings = timer.snapshot()
    writeBenchmarkReport("context-ai-sdk-real-direct-report", {
      test: "context ai sdk reactor + real AI Gateway model > executes a real model directly in non-durable mode and persists final state",
      mode: "direct",
      model: REAL_MODEL,
      totalMs: timings.totalMs,
      stageTimingsMs: timings.stageTimingsMs,
      contextId: result.context.id,
      executionId: result.execution.id,
      chunksCount: chunks.length,
    })
  }, 10 * 60 * 1000)
})
