/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { tool } from "ai"
import { init } from "@instantdb/admin"
import { z } from "zod"
import { randomUUID } from "node:crypto"

import {
  createScriptedReactor,
  createContext,
  didToolExecute,
  eventsDomain,
  type ContextItem,
} from "../index.ts"
import { describeInstant, itInstant, destroyContextTestApp, provisionContextTestApp } from "./_env.ts"
import { createStageTimer, writeBenchmarkReport } from "./_benchmark.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

type ContextTestEnv = {
  orgId: string
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

let appId: string | null = null
let adminToken: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Context test runtime DB is not initialized.")
  }
  return db
}

describeInstant("context scripted reactor + Instant runtime", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-scripted-${Date.now()}`,
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

  itInstant("executes directly in non-durable mode and completes persisted shell state", async () => {
    const timer = createStageTimer()
    const contextKey = `context-scripted-context:${Date.now()}`
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      orgId: "org_context_tests",
      actorId: "user_context_tests",
    })

    const scriptedContext = createContext<ContextTestEnv>("context.tests.scripted.lifecycle")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
        actorId: env.actorId,
      }))
      .narrative(() => "Deterministic scripted test context.")
      .actions(() => ({
        set_status: tool({
          description: "Apply deterministic status update.",
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => ({ ok: true, value }),
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "Applying update." },
                    {
                      type: "tool-set_status",
                      toolCallId: "tc_set_status_1",
                      input: { value: "ready" },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "tc_set_status_1",
                  actionName: "set_status",
                  input: { value: "ready" },
                },
              ],
              messagesForModel: [],
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const result = await timer.measure("reactMs", async () =>
      await scriptedContext.react(createTriggerEvent("set status to ready"), {
        runtime,
        context: { key: contextKey },
        durable: false,
        __benchmark: timer,
        options: {
          silent: true,
          maxIterations: 3,
          maxModelSteps: 1,
        },
      }),
    )

    expect(result.context.id).toBeTruthy()
    expect(result.context.status).toBe("closed")
    expect(result.trigger.id).toBeTruthy()
    expect(result.trigger.status).toBe("stored")
    expect(result.reaction.id).toBeTruthy()
    expect(result.reaction.status).toBe("completed")
    expect(result.execution.id).toBeTruthy()
    expect(result.execution.status).toBe("completed")

    const snapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_contexts: {
          $: { where: { key: contextKey }, limit: 1 },
        },
        event_executions: {
          $: { where: { id: result.execution.id }, limit: 1 },
        },
        event_steps: {
          $: { where: { "execution.id": result.execution.id }, limit: 10 },
        },
        event_items: {
          $: { where: { "context.id": result.context.id }, limit: 20 },
        },
      }),
    )

    const contextRow = readRows(snapshot, "event_contexts")[0]
    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRow = readRows(snapshot, "event_steps")[0]
    const itemRows = readRows(snapshot, "event_items")
    const stepId = readString(stepRow, "id")
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

    expect(readString(contextRow, "status")).toBe("closed")
    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(null)
    expect(readString(stepRow, "status")).toBe("completed")

    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reaction.id)
    expect(readString(reactionItem, "status")).toBe("completed")

    const hasToolOutput = partRows.some((row) => {
      const part = asRecord(row.part)
      if (!part) return false
      return part.type === "tool-result" && part.state === "output-available"
    })
    expect(hasToolOutput).toBe(true)

    const timings = timer.snapshot()
    writeBenchmarkReport("context-scripted-direct-report", {
      test: "context scripted reactor + Instant runtime > executes directly in non-durable mode and completes persisted shell state",
      mode: "direct",
      totalMs: timings.totalMs,
      stageTimingsMs: timings.stageTimingsMs,
      contextId: result.context.id,
      executionId: result.execution.id,
    })
  }, 5 * 60 * 1000)

  itInstant("marks execution as failed when scripted steps are exhausted in non-durable mode", async () => {
    const timer = createStageTimer()
    const contextKey = `context-scripted-fail-context:${Date.now()}`
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      orgId: "org_context_tests",
      actorId: "user_context_tests",
    })

    const failingContext = createContext<ContextTestEnv>("context.tests.scripted.failure")
      .context((stored) => ({ ...(stored.content ?? {}) }))
      .narrative(() => "Scripted failure test.")
      .actions(() => ({
        keep_looping: tool({
          description: "No-op tool used to keep the loop running.",
          inputSchema: z.object({ note: z.string() }),
          execute: async ({ note }) => ({ ok: true, note }),
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "First iteration." },
                    {
                      type: "tool-keep_looping",
                      toolCallId: "tc_keep_looping_1",
                      input: { note: "continue" },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "tc_keep_looping_1",
                  actionName: "keep_looping",
                  input: { note: "continue" },
                },
              ],
              messagesForModel: [],
            },
          ],
          repeatLast: false,
        }),
      )
      .shouldContinue(() => true)
      .build()

    await expect(
      timer.measure("reactMs", async () =>
        await failingContext.react(createTriggerEvent("force scripted exhaustion"), {
          runtime,
          context: { key: contextKey },
          durable: false,
          __benchmark: timer,
          options: {
            silent: true,
            maxIterations: 3,
            maxModelSteps: 1,
          },
        }),
      ),
    ).rejects.toThrow("createScriptedReactor: no scripted step available")

    const failureSnapshot = await timer.measure("snapshotQueryMs", async () =>
      await currentDb().query({
        event_contexts: {
          $: { where: { key: contextKey }, limit: 1 },
        },
        event_executions: {
          $: { where: { "context.key": contextKey as any }, limit: 10 },
        },
      }),
    )

    const contextRow = readRows(failureSnapshot, "event_contexts")[0]
    const executionRow = readRows(failureSnapshot, "event_executions")[0]
    const executionId = readString(executionRow, "id")

    expect(readString(contextRow, "status")).toBe("closed")
    expect(readString(executionRow, "status")).toBe("failed")
    expect(readString(executionRow, "workflowRunId")).toBe(null)
    expect(executionId).toBeTruthy()

    const timings = timer.snapshot()
    writeBenchmarkReport("context-scripted-direct-failure-report", {
      test: "context scripted reactor + Instant runtime > marks execution as failed when scripted steps are exhausted in non-durable mode",
      mode: "direct",
      totalMs: timings.totalMs,
      stageTimingsMs: timings.stageTimingsMs,
      executionId,
    })
  }, 5 * 60 * 1000)

  itInstant("passes engine-expanded standard events to provider-neutral reactors", async () => {
    const contextKey = `context-scripted-expanded-events:${Date.now()}`
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      orgId: "org_context_tests",
      actorId: "user_context_tests",
    })
    let reactorSawExpandedEvent = false

    const expandedContext = createContext<ContextTestEnv>("context.tests.scripted.expanded-events")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
        actorId: env.actorId,
      }))
      .expandEvents((events) => [
        ...events,
        {
          id: `derived:${events[0]?.id ?? "missing"}:canvas`,
          type: "output",
          channel: "web",
          createdAt: new Date().toISOString(),
          content: {
            parts: [
              {
                type: "content",
                state: "done",
                content: [
                  {
                    type: "text",
                    text: "Derived canvas snapshot reference.",
                  },
                  {
                    type: "file",
                    mediaType: "image/png",
                    filename: "canvas.png",
                    data: "QUFBQQ==",
                  },
                ],
                metadata: {
                  canvas: {
                    sceneId: "scene_expanded",
                    sceneVersion: 7,
                    sceneRect: { x: 10, y: 20, width: 300, height: 200 },
                    scaleX: 1,
                    scaleY: 1,
                  },
                },
              },
            ],
          },
        } satisfies ContextItem,
      ])
      .narrative(() => "Expanded events should reach this reactor.")
      .actions(() => ({}))
      .reactor(async (params) => {
        reactorSawExpandedEvent = params.events.some((event) =>
          String(event.id).startsWith("derived:") &&
          JSON.stringify(event.content.parts ?? []).includes("Derived canvas snapshot reference"),
        )
        return {
          assistantEvent: {
            id: params.eventId,
            type: "output",
            channel: "web",
            createdAt: new Date().toISOString(),
            content: {
              parts: [{ type: "text", text: "Saw expanded event." }],
            },
          },
          actionRequests: [],
          messagesForModel: [],
        }
      })
      .shouldContinue(() => false)
      .build()

    await expandedContext.react(createTriggerEvent("use expanded canvas context"), {
      runtime,
      context: { key: contextKey },
      durable: false,
      options: {
        silent: true,
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(reactorSawExpandedEvent).toBe(true)
  }, 5 * 60 * 1000)
})
