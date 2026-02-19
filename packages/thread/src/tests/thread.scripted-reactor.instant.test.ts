/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { tool } from "ai"
import { configureRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { z } from "zod"
import { randomUUID } from "node:crypto"

import {
  assertThreadStreamTransitions,
  createScriptedReactor,
  createThread,
  didToolExecute,
  parseThreadStreamEvent,
  threadDomain,
  validateThreadStreamTimeline,
  type ThreadItem,
  type ThreadStreamEvent,
} from "../index.ts"
import { describeInstant, itInstant, destroyThreadTestApp, provisionThreadTestApp } from "./_env.ts"

type ThreadTestEnv = {
  orgId: string
  actorId: string
  workflowRunId: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function readRows(
  queryResult: unknown,
  key: string,
): Record<string, unknown>[] {
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

let appId: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Thread test runtime DB is not initialized.")
  }
  return db
}

describeInstant("thread scripted reactor + Instant runtime", () => {
  beforeAll(async () => {
    const schema = threadDomain.toInstantSchema()
    const app = await provisionThreadTestApp({
      name: `thread-scripted-${Date.now()}`,
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

  itInstant("persists deterministic lifecycle and trace events with scripted reactor", async () => {
    const workflowRunId = `thread-run-${Date.now()}`
    const contextKey = `thread-scripted-context:${workflowRunId}`

    const scriptedThread = createThread<ThreadTestEnv>("thread.tests.scripted.lifecycle")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
        actorId: env.actorId,
      }))
      .narrative(() => "Deterministic scripted test thread.")
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
              toolCalls: [
                {
                  toolCallId: "tc_set_status_1",
                  toolName: "set_status",
                  args: { value: "ready" },
                },
              ],
              messagesForModel: [],
              llm: {
                provider: "scripted",
                model: "scripted-reactor",
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                latencyMs: 0,
              },
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "set_status"))
      .build()

    const env: ThreadTestEnv = {
      orgId: "org_thread_tests",
      actorId: "user_thread_tests",
      workflowRunId,
    }

    const result = await scriptedThread.react(createTriggerEvent("set status to ready"), {
      env,
      context: { key: contextKey },
      options: {
        silent: true,
        maxIterations: 3,
        maxModelSteps: 1,
      },
    })

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

    const triggerItem = itemRows.find((row) => readString(row, "id") === result.triggerEventId)
    const reactionItem = itemRows.find((row) => readString(row, "id") === result.reactionEventId)
    expect(readString(triggerItem, "status")).toBe("stored")
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

  itInstant("marks execution as failed when scripted steps are exhausted mid-loop", async () => {
    const workflowRunId = `thread-run-fail-${Date.now()}`
    const contextKey = `thread-scripted-fail-context:${workflowRunId}`

    const failingThread = createThread<ThreadTestEnv>("thread.tests.scripted.failure")
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
              toolCalls: [
                {
                  toolCallId: "tc_keep_looping_1",
                  toolName: "keep_looping",
                  args: { note: "continue" },
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

    const env: ThreadTestEnv = {
      orgId: "org_thread_tests",
      actorId: "user_thread_tests",
      workflowRunId,
    }

    await expect(
      failingThread.react(createTriggerEvent("force scripted exhaustion"), {
        env,
        context: { key: contextKey },
        options: {
          silent: true,
          maxIterations: 3,
          maxModelSteps: 1,
        },
      }),
    ).rejects.toThrow("createScriptedReactor: no scripted step available")

    const failureSnapshot = await currentDb().query({
      thread_threads: {
        $: { where: { key: contextKey }, limit: 1 },
      },
      thread_contexts: {
        $: { where: { key: contextKey }, limit: 1 },
      },
      thread_executions: {
        $: { where: { workflowRunId }, limit: 10 },
      },
    })

    const threadRow = readRows(failureSnapshot, "thread_threads")[0]
    const contextRow = readRows(failureSnapshot, "thread_contexts")[0]
    const executionRow = readRows(failureSnapshot, "thread_executions")[0]
    const executionId = readString(executionRow, "id")

    expect(readString(threadRow, "status")).toBe("failed")
    expect(readString(contextRow, "status")).toBe("open")
    expect(readString(executionRow, "status")).toBe("failed")
    expect(executionId).toBeTruthy()

    const stepSnapshot = executionId
      ? await currentDb().query({
          thread_steps: {
            $: { where: { executionId }, limit: 20 },
          },
        })
      : null
    const stepRows = stepSnapshot ? readRows(stepSnapshot, "thread_steps") : []
    const stepStatuses = new Set(stepRows.map((row) => String(readString(row, "status"))))
    expect(stepStatuses.has("completed")).toBe(true)
    expect(stepStatuses.has("failed")).toBe(true)
  }, 5 * 60 * 1000)

  itInstant("parses and validates typed transition timeline from SSE payloads", async () => {
    const timelineRaw: unknown[] = [
      {
        type: "context.resolved",
        contextId: "ctx_03",
        threadId: "thr_03",
        status: "open",
        at: "2026-02-19T03:20:00.000Z",
      },
      {
        type: "thread.resolved",
        threadId: "thr_03",
        status: "open",
        at: "2026-02-19T03:20:00.010Z",
      },
      {
        type: "context.status.changed",
        contextId: "ctx_03",
        threadId: "thr_03",
        from: "open",
        to: "streaming",
        at: "2026-02-19T03:20:00.020Z",
      },
      {
        type: "thread.status.changed",
        threadId: "thr_03",
        from: "open",
        to: "streaming",
        at: "2026-02-19T03:20:00.021Z",
      },
      {
        type: "execution.created",
        executionId: "exe_03",
        contextId: "ctx_03",
        threadId: "thr_03",
        status: "executing",
        at: "2026-02-19T03:20:00.030Z",
      },
      {
        type: "step.created",
        stepId: "stp_03",
        executionId: "exe_03",
        iteration: 0,
        status: "running",
        at: "2026-02-19T03:20:00.040Z",
      },
      {
        type: "item.created",
        itemId: "itm_03",
        contextId: "ctx_03",
        threadId: "thr_03",
        executionId: "exe_03",
        status: "stored",
        at: "2026-02-19T03:20:00.050Z",
      },
      {
        type: "item.status.changed",
        itemId: "itm_03",
        executionId: "exe_03",
        from: "stored",
        to: "pending",
        at: "2026-02-19T03:20:00.060Z",
      },
      {
        type: "step.status.changed",
        stepId: "stp_03",
        executionId: "exe_03",
        from: "running",
        to: "completed",
        at: "2026-02-19T03:20:00.070Z",
      },
      {
        type: "part.created",
        partKey: "stp_03:0",
        stepId: "stp_03",
        idx: 0,
        at: "2026-02-19T03:20:00.071Z",
      },
      {
        type: "item.status.changed",
        itemId: "itm_03",
        executionId: "exe_03",
        from: "pending",
        to: "completed",
        at: "2026-02-19T03:20:00.080Z",
      },
      {
        type: "chunk.emitted",
        chunkType: "data-context-id",
        contextId: "ctx_03",
        executionId: "exe_03",
        stepId: "stp_03",
        at: "2026-02-19T03:20:00.081Z",
      },
      {
        type: "execution.status.changed",
        executionId: "exe_03",
        contextId: "ctx_03",
        threadId: "thr_03",
        from: "executing",
        to: "completed",
        at: "2026-02-19T03:20:00.090Z",
      },
      {
        type: "context.status.changed",
        contextId: "ctx_03",
        threadId: "thr_03",
        from: "streaming",
        to: "open",
        at: "2026-02-19T03:20:00.100Z",
      },
      {
        type: "thread.status.changed",
        threadId: "thr_03",
        from: "streaming",
        to: "open",
        at: "2026-02-19T03:20:00.101Z",
      },
      {
        type: "thread.finished",
        threadId: "thr_03",
        contextId: "ctx_03",
        executionId: "exe_03",
        result: "completed",
        at: "2026-02-19T03:20:00.110Z",
      },
    ]

    const timeline = timelineRaw.map((entry) => parseThreadStreamEvent(entry))
    validateThreadStreamTimeline(timeline)

    const resolvedContexts = timeline.filter(
      (event): event is ThreadStreamEvent => event.type === "context.resolved",
    )
    const createdContexts = timeline.filter(
      (event): event is ThreadStreamEvent => event.type === "context.created",
    )

    expect(resolvedContexts.length).toBe(1)
    expect(createdContexts.length).toBe(0)

    expect(() =>
      assertThreadStreamTransitions(
        parseThreadStreamEvent({
          type: "execution.status.changed",
          executionId: "exe_invalid",
          contextId: "ctx_invalid",
          threadId: "thr_invalid",
          from: "completed",
          to: "executing",
          at: "2026-02-19T03:20:00.200Z",
        }),
      ),
    ).toThrow("Invalid execution.status transition")
  })
})
