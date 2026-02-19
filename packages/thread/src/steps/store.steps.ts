import type { UIMessageChunk } from "ai"

import type { ThreadEnvironment } from "../thread.config.js"
import type { ThreadItem, ContextIdentifier, StoredContext } from "../thread.store.js"
import type { ThreadTraceEventWrite } from "./trace.steps.js"
import { writeThreadTraceEvents } from "./trace.steps.js"
import {
  getClientResumeHookUrl,
  toolApprovalHookToken,
  toolApprovalWebhookToken,
} from "../thread.hooks.js"

async function maybeWriteTraceEvents(
  env: ThreadEnvironment,
  traceEvents?: ThreadTraceEventWrite[],
) {
  if (!traceEvents?.length) return
  try {
    await writeThreadTraceEvents({ env, events: traceEvents })
  } catch {
    if (process.env.PLAYWRIGHT_TEST === "1") {
      // eslint-disable-next-line no-console
      console.warn("[thread/trace] emit failed")
    }
  }
}

type WorkflowMeta = {
  workflowRunId?: string | number
  url?: string
  [key: string]: unknown
}

export type ThreadReviewRequest = {
  toolCallId: string
  toolName?: string
}

async function readWorkflowMetadata(): Promise<WorkflowMeta | null> {
  try {
    const { getWorkflowMetadata } = await import("workflow")
    return ((getWorkflowMetadata?.() as unknown) as WorkflowMeta) ?? null
  } catch {
    return null
  }
}

function parseRunIdFromTriggerId(triggerEventId?: string) {
  if (typeof triggerEventId !== "string") return undefined
  if (!triggerEventId.startsWith("e2e-trigger:")) return undefined
  const parsed = triggerEventId.slice("e2e-trigger:".length).trim()
  return parsed || undefined
}

async function resolveWorkflowRunId(params: {
  env: ThreadEnvironment
  db?: any
  triggerEventId?: string
  executionId?: string
}) {
  const meta = await readWorkflowMetadata()
  let runId =
    meta && meta.workflowRunId !== undefined && meta.workflowRunId !== null
      ? String(meta.workflowRunId)
      : ""

  if (!runId) {
    const envRunId = (params.env as any)?.workflowRunId
    if (typeof envRunId === "string" && envRunId.trim()) {
      runId = envRunId.trim()
    }
  }

  if (!runId && params.triggerEventId) {
    const parsed = parseRunIdFromTriggerId(params.triggerEventId)
    if (parsed) runId = parsed
  }

  if (!runId && params.executionId && params.db) {
    try {
      const q = await params.db.query({
        thread_executions: {
          $: { where: { id: String(params.executionId) }, limit: 1 },
        },
      })
      const row = (q as any)?.thread_executions?.[0]
      if (row?.workflowRunId) {
        runId = String(row.workflowRunId)
      }
    } catch {
      // ignore
    }
  }

  return { runId: runId || undefined, meta }
}

function inferDirection(item: ThreadItem): "inbound" | "outbound" | undefined {
  const type = typeof item?.type === "string" ? item.type : ""
  if (type.startsWith("output") || type.startsWith("tool") || type.startsWith("assistant")) {
    return "outbound"
  }
  if (type.startsWith("input") || type.startsWith("user")) {
    return "inbound"
  }
  return undefined
}

function shouldDebugThreadStoreSteps() {
  return process.env.EKAIROS_THREAD_DEBUG === "1"
}

function summarizeStepError(error: unknown): Record<string, unknown> {
  const err = error as any
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    status: err?.status ?? err?.statusCode,
    details: err?.details ?? err?.body ?? err?.response ?? err?.data,
    stack:
      typeof err?.stack === "string"
        ? err.stack.slice(0, 1500)
        : undefined,
  }
}

function summarizeContextIdentifierForLog(identifier: ContextIdentifier) {
  return {
    id:
      identifier && typeof (identifier as any).id === "string"
        ? String((identifier as any).id)
        : undefined,
    key:
      identifier && typeof (identifier as any).key === "string"
        ? String((identifier as any).key)
        : undefined,
  }
}

function logStepDebug(message: string, payload: Record<string, unknown>) {
  if (!shouldDebugThreadStoreSteps()) return
  // eslint-disable-next-line no-console
  console.error(`[thread][store.steps] ${message}`, payload)
}

/**
 * Initializes/ensures the story context exists and emits a single `data-context-id` chunk.
 *
 * This is the "context init" boundary for the story engine.
 */
export async function initializeContext<C>(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier | null,
  opts?: { silent?: boolean; writable?: WritableStream<UIMessageChunk> },
): Promise<{ context: StoredContext<C>; isNew: boolean }> {
  "use step"

  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(env)
  const { store, db } = runtime

  // Detect creation explicitly so the engine can run onContextCreated hooks.
  let result: { context: StoredContext<C>; isNew: boolean }
  if (!contextIdentifier) {
    const context = await store.getOrCreateContext<C>(null)
    result = { context, isNew: true }
  } else {
    const existing = await store.getContext<C>(contextIdentifier)
    if (existing) {
      result = { context: existing, isNew: false }
    } else {
      const created = await store.getOrCreateContext<C>(contextIdentifier)
      result = { context: created, isNew: true }
    }
  }

  // If we're running in a non-streaming context (e.g. tests or headless usage),
  // we skip writing stream chunks entirely.
  if (!opts?.silent && opts?.writable) {
    const writer = opts.writable.getWriter()
    try {
      await writer.write({
        type: "data-context-id",
        id: String(result.context.id),
        data: { contextId: String(result.context.id) },
      } as any)
    } finally {
      writer.releaseLock()
    }
  }

  const { runId } = await resolveWorkflowRunId({ env, db })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `thread_context:${String(result.context.id)}`,
        eventKind: "thread.context",
        eventAt: new Date().toISOString(),
        contextId: String(result.context.id),
        contextKey: result.context.key ?? undefined,
        payload: {
          ...result.context,
          action: result.isNew ? "created" : "updated",
        },
      },
    ])
  }

  return result
}

export async function updateContextContent<C>(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  content: C,
): Promise<StoredContext<C>> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(env)
  return await store.updateContextContent<C>(contextIdentifier, content)
}

export async function updateContextStatus(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  status: "open" | "streaming" | "closed",
): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(env)
  await store.updateContextStatus(contextIdentifier, status)
}

export async function saveTriggerItem(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  event: ThreadItem,
): Promise<ThreadItem> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(env)
  const saved = await store.saveItem(contextIdentifier, event)
  return saved
}

export async function emitContextIdChunk(params: {
  env: ThreadEnvironment
  contextId: string
  writable?: WritableStream<UIMessageChunk>
}) {
  "use step"
  if (!params.writable) return
  const writer = params.writable.getWriter()
  try {
    await writer.write({
      type: "data-context-id",
      id: String(params.contextId),
      data: { contextId: String(params.contextId) },
    } as any)
  } finally {
    writer.releaseLock()
  }
}

export async function saveTriggerAndCreateExecution(params: {
  env: ThreadEnvironment
  contextIdentifier: ContextIdentifier
  triggerEvent: ThreadItem
}): Promise<{
  triggerEvent: ThreadItem
  triggerEventId: string
  reactionEventId: string
  executionId: string
}> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(params.env)
  const { store, db } = runtime
  logStepDebug("saveTriggerAndCreateExecution:start", {
    contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
    triggerEventId: (params.triggerEvent as any)?.id,
    triggerEventType: (params.triggerEvent as any)?.type,
    triggerEventChannel: (params.triggerEvent as any)?.channel,
    triggerEventCreatedAt: (params.triggerEvent as any)?.createdAt,
  })

  let saved: ThreadItem
  try {
    saved = await store.saveItem(params.contextIdentifier, params.triggerEvent)
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:saveItem:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
      triggerEventId: (params.triggerEvent as any)?.id,
      error: summarizeStepError(error),
    })
    throw error
  }

  const uuid = (globalThis.crypto as any)?.randomUUID?.()
  const reactionEventId =
    typeof uuid === "string"
      ? uuid
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  try {
    await store.updateContextStatus(params.contextIdentifier, "streaming")
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:updateContextStatus:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
      triggerEventId: saved.id,
      reactionEventId,
      error: summarizeStepError(error),
    })
    throw error
  }

  let execution: { id: string }
  try {
    execution = await store.createExecution(
      params.contextIdentifier,
      saved.id,
      reactionEventId,
    )
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:createExecution:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
      triggerEventId: saved.id,
      reactionEventId,
      error: summarizeStepError(error),
    })
    throw error
  }

  const { runId, meta } = await resolveWorkflowRunId({
    env: params.env,
    db,
    triggerEventId: saved.id,
    executionId: execution.id,
  })

  if (runId && db) {
    try {
      await db.transact([
        db.tx.thread_executions[execution.id].update({
          workflowRunId: runId,
          updatedAt: new Date(),
        }),
      ])
    } catch {
      // ignore
    }
  }

  if (runId) {
    let contextKey: string | undefined
    let contextId: string | undefined
    try {
      const ctx = await store.getContext(params.contextIdentifier)
      contextKey = ctx?.key ?? undefined
      contextId = ctx?.id ? String(ctx.id) : undefined
    } catch {
      // ignore
    }

    const events: ThreadTraceEventWrite[] = [
      {
        workflowRunId: runId,
        eventId: `workflow_run:${String(runId)}`,
        eventKind: "workflow.run",
        eventAt: new Date().toISOString(),
        payload: meta ?? null,
      },
      {
        workflowRunId: runId,
        eventId: `thread_run:${String(execution.id)}`,
        eventKind: "thread.run",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(execution.id),
        payload: {
          contextKey: contextKey ?? null,
          contextId: contextId ?? null,
          triggerEventId: saved.id,
          reactionEventId,
          workflowMeta: meta ?? null,
        },
      },
      {
        workflowRunId: runId,
        eventId: `thread_execution:${String(execution.id)}`,
        eventKind: "thread.execution",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(execution.id),
        payload: {
          status: "started",
        },
      },
      {
        workflowRunId: runId,
        eventId: `thread_item:${String(saved.id)}`,
        eventKind: "thread.item",
        eventAt: new Date().toISOString(),
        contextId,
        contextEventId: String(saved.id),
        payload: {
          ...saved,
          direction: "inbound",
        },
      },
    ]

    await maybeWriteTraceEvents(params.env, events)
  }

  return {
    triggerEvent: saved,
    triggerEventId: saved.id,
    reactionEventId,
    executionId: execution.id,
  }
}

export async function saveReactionItem(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  event: ThreadItem,
  opts?: {
    executionId?: string
    contextId?: string
    reviewRequests?: ThreadReviewRequest[]
  },
): Promise<ThreadItem> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(env)
  const { store, db } = runtime
  const saved = await store.saveItem(contextIdentifier, event)
  const contextId =
    opts?.contextId ??
    (typeof (contextIdentifier as any)?.id === "string"
      ? String((contextIdentifier as any).id)
      : undefined)

  const { runId, meta } = await resolveWorkflowRunId({
    env,
    db,
    executionId: opts?.executionId,
  })
  if (runId) {
    const events: ThreadTraceEventWrite[] = [
      {
        workflowRunId: runId,
        eventId: `thread_item:${String(saved.id)}`,
        eventKind: "thread.item",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: opts?.executionId,
        contextEventId: String(saved.id),
        payload: {
          ...saved,
          direction: "outbound",
        },
      },
    ]

    if (opts?.executionId && opts.reviewRequests?.length) {
      const resumeHookUrl = getClientResumeHookUrl()
      const workflowUrl =
        meta && typeof meta.url === "string" && meta.url.trim()
          ? String(meta.url)
          : undefined
      for (const rr of opts.reviewRequests) {
        const toolCallId = String(rr.toolCallId)
        events.push({
          workflowRunId: runId,
          eventId: `thread_review:${String(opts.executionId)}:${toolCallId}`,
          eventKind: "thread.review",
          eventAt: new Date().toISOString(),
          contextId,
          executionId: String(opts.executionId),
          toolCallId,
          payload: {
            status: "in_review",
            toolName: rr.toolName ?? "",
            hookToken: toolApprovalHookToken({
              executionId: String(opts.executionId),
              toolCallId,
            }),
            webhookToken: toolApprovalWebhookToken({
              executionId: String(opts.executionId),
              toolCallId,
            }),
            resumeHookUrl,
            workflowUrl,
          },
        })
      }
    }

    await maybeWriteTraceEvents(env, events)
  }
  return saved
}

export async function updateItem(
  env: ThreadEnvironment,
  eventId: string,
  event: ThreadItem,
  opts?: { executionId?: string; contextId?: string },
): Promise<ThreadItem> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(env)
  const { store, db } = runtime
  const saved = await store.updateItem(eventId, event)

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId: opts?.executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `thread_item:${String(saved.id)}`,
        eventKind: "thread.item",
        eventAt: new Date().toISOString(),
        contextId: opts?.contextId,
        executionId: opts?.executionId,
        contextEventId: String(saved.id),
        payload: {
          ...saved,
          direction: inferDirection(saved),
        },
      },
    ])
  }
  return saved
}

export async function createExecution(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  triggerEventId: string,
  reactionEventId: string,
): Promise<{ id: string }> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(env)
  return await store.createExecution(contextIdentifier, triggerEventId, reactionEventId)
}

export async function createReactionItem(params: {
  env: ThreadEnvironment
  contextIdentifier: ContextIdentifier
  triggerEventId: string
}): Promise<{ reactionEventId: string; executionId: string }> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(params.env)

  // Generate a new reaction event id inside the step boundary.
  const uuid = (globalThis.crypto as any)?.randomUUID?.()
  const reactionEventId =
    typeof uuid === "string"
      ? uuid
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  await store.updateContextStatus(params.contextIdentifier, "streaming")
  const execution = await store.createExecution(
    params.contextIdentifier,
    params.triggerEventId,
    reactionEventId,
  )

  return { reactionEventId, executionId: execution.id }
}

export async function completeExecution(
  env: ThreadEnvironment,
  contextIdentifier: ContextIdentifier,
  executionId: string,
  status: "completed" | "failed",
): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(env)
  const { store, db } = runtime
  await store.completeExecution(contextIdentifier, executionId, status)
  const contextId =
    typeof (contextIdentifier as any)?.id === "string"
      ? String((contextIdentifier as any).id)
      : undefined

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `thread_execution:${String(executionId)}:${status}`,
        eventKind: "thread.execution",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(executionId),
        payload: {
          status,
        },
      },
    ])
  }
}

export async function updateExecutionWorkflowRun(params: {
  env: ThreadEnvironment
  executionId: string
  workflowRunId: string
}): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(params.env)
  const db: any = (runtime as any)?.db
  if (db) {
    await db.transact([
      db.tx.thread_executions[params.executionId].update({
        workflowRunId: params.workflowRunId,
        updatedAt: new Date(),
      }),
    ])
  }
}

export async function createThreadStep(params: {
  env: ThreadEnvironment
  executionId: string
  iteration: number
}): Promise<{ stepId: string; eventId: string }> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(params.env)
  const res = await store.createStep({
    executionId: params.executionId,
    iteration: params.iteration,
  })
  return { stepId: res.id, eventId: res.eventId }
}

export async function updateThreadStep(params: {
  env: ThreadEnvironment
  stepId: string
  executionId?: string
  contextId?: string
  iteration?: number
  patch: {
    status?: "running" | "completed" | "failed"
    toolCalls?: any
    toolExecutionResults?: any
    continueLoop?: boolean
    errorText?: string
  }
}): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(params.env)
  const { store, db } = runtime
  await store.updateStep(params.stepId, {
    ...(params.patch as any),
    updatedAt: new Date(),
  })

  const { runId } = await resolveWorkflowRunId({
    env: params.env,
    db,
    executionId: params.executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(params.env, [
      {
        workflowRunId: runId,
        eventId: `thread_step:${String(params.stepId)}`,
        eventKind: "thread.step",
        eventAt: new Date().toISOString(),
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: String(params.stepId),
        payload: {
          status: params.patch.status,
          iteration: params.iteration,
          toolCalls: params.patch.toolCalls,
          toolExecutionResults: params.patch.toolExecutionResults,
          continueLoop: params.patch.continueLoop,
          errorText: params.patch.errorText,
        },
      },
    ])
  }
}

export async function linkItemToExecutionStep(params: {
  env: ThreadEnvironment
  itemId: string
  executionId: string
}): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(params.env)
  await store.linkItemToExecution({ itemId: params.itemId, executionId: params.executionId })
}

export async function saveThreadPartsStep(params: {
  env: ThreadEnvironment
  stepId: string
  executionId?: string
  contextId?: string
  iteration?: number
  parts: any[]
}): Promise<void> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = await getThreadRuntime(params.env)
  const { store, db } = runtime
  await store.saveStepParts({ stepId: params.stepId, parts: params.parts })

  const { runId } = await resolveWorkflowRunId({
    env: params.env,
    db,
    executionId: params.executionId,
  })
  if (runId && params.parts?.length) {
    const events: ThreadTraceEventWrite[] = []
    for (let idx = 0; idx < params.parts.length; idx += 1) {
      const part = params.parts[idx]
      events.push({
        workflowRunId: runId,
        eventId: `thread_part:${String(params.stepId)}:${idx}`,
        eventKind: "thread.part",
        eventAt: new Date().toISOString(),
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: String(params.stepId),
        partKey: `${String(params.stepId)}:${idx}`,
        partIdx: idx,
        payload: part,
      })
    }
    await maybeWriteTraceEvents(params.env, events)
  }
}

