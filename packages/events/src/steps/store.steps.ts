import type { UIMessageChunk } from "ai"

import type { ContextEnvironment } from "../context.config.js"
import type { ContextRuntime } from "../context.runtime.js"
import { getContextRuntimeServices } from "../context.runtime.js"
import type {
  ContextExecution,
  ContextItem,
  ContextIdentifier,
  StoredContext,
  ContextStatus,
} from "../context.store.js"
import { OUTPUT_ITEM_TYPE, WEB_CHANNEL } from "../context.events.js"
import type { ContextTraceEventWrite } from "./trace.steps.js"
import { writeContextTraceEvents } from "./trace.steps.js"
import {
  getClientResumeHookUrl,
  toolApprovalHookToken,
  toolApprovalWebhookToken,
} from "../context.hooks.js"

type RuntimeParams<Env extends ContextEnvironment = ContextEnvironment> = {
  runtime: ContextRuntime<Env>
}

async function getRuntimeAndEnv<Env extends ContextEnvironment>(params: RuntimeParams<Env>) {
  const env = params.runtime.env
  const runtime = await getContextRuntimeServices(params.runtime)
  return { runtime, env }
}

async function maybeWriteTraceEvents(
  env: ContextEnvironment,
  traceEvents?: ContextTraceEventWrite[],
) {
  if (!traceEvents?.length) return
  try {
    await writeContextTraceEvents({ env, events: traceEvents })
  } catch {
    if (process.env.PLAYWRIGHT_TEST === "1") {
      // eslint-disable-next-line no-console
      console.warn("[context/trace] emit failed")
    }
  }
}

type WorkflowMeta = {
  workflowRunId?: string | number
  url?: string
  [key: string]: unknown
}

export type ContextReviewRequest = {
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

async function resolveWorkflowRunId(params: {
  env: ContextEnvironment
  db?: any
  executionId?: string
}) {
  let runId = ""
  const meta = await readWorkflowMetadata()
  if (meta && meta.workflowRunId !== undefined && meta.workflowRunId !== null) {
    runId = String(meta.workflowRunId)
  }

  if (!runId && params.executionId && params.db) {
    try {
      const q = await params.db.query({
        event_executions: {
          $: { where: { id: String(params.executionId) }, limit: 1 },
        },
      })
      const row = (q as any)?.event_executions?.[0]
      if (row?.workflowRunId) {
        runId = String(row.workflowRunId)
      }
    } catch {
      // ignore
    }
  }

  return { runId: runId || undefined, meta }
}

function inferDirection(item: ContextItem): "inbound" | "outbound" | undefined {
  const type = typeof item?.type === "string" ? String(item.type) : ""
  if (type === "input") return "inbound"
  if (type === "output") return "outbound"
  return undefined
}

function shouldDebugContextStoreSteps() {
  return process.env.EKAIROS_CONTEXT_DEBUG === "1"
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
  if (!shouldDebugContextStoreSteps()) return
  // eslint-disable-next-line no-console
  console.error(`[context][store.steps] ${message}`, payload)
}

/**
 * Initializes/ensures the story context exists.
 *
 * This is the "context init" boundary for the story engine.
 */
export async function initializeContext<C>(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier | null
    opts?: { silent?: boolean; writable?: WritableStream<UIMessageChunk> }
  },
): Promise<{ context: StoredContext<C>; isNew: boolean }> {
  "use step"

  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime

  // Detect creation explicitly so the engine can run onContextCreated hooks.
  let result: { context: StoredContext<C>; isNew: boolean }
  if (!params.contextIdentifier) {
    const context = await store.getOrCreateContext<C>(null)
    result = { context, isNew: true }
  } else {
    const existing = await store.getContext<C>(params.contextIdentifier)
    if (existing) {
      result = { context: existing, isNew: false }
    } else {
      const created = await store.getOrCreateContext<C>(params.contextIdentifier)
      result = { context: created, isNew: true }
    }
  }

  const { runId } = await resolveWorkflowRunId({ env, db })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `context_entity:${String(result.context.id)}`,
        eventKind: "context.lifecycle",
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
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    content: C
  },
): Promise<StoredContext<C>> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  return await runtime.store.updateContextContent<C>(params.contextIdentifier, params.content)
}

export async function updateContextReactor<C>(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    reactor: { kind: string; state?: Record<string, unknown> | null }
  },
): Promise<StoredContext<C>> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  return await runtime.store.updateContextReactor<C>(params.contextIdentifier, params.reactor)
}

export async function updateContextStatus(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    status: ContextStatus
  },
): Promise<void> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  await runtime.store.updateContextStatus(params.contextIdentifier, params.status)
}

export async function saveTriggerItem(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    event: ContextItem
  },
): Promise<ContextItem> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  return await runtime.store.saveItem(params.contextIdentifier, params.event)
}

export async function saveTriggerAndCreateExecution(params: {
  runtime: ContextRuntime<ContextEnvironment>
  contextIdentifier: ContextIdentifier
  triggerEvent: ContextItem
}): Promise<{
  triggerEvent: ContextItem
  reactionEvent: ContextItem
  execution: ContextExecution
}> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  logStepDebug("saveTriggerAndCreateExecution:start", {
    contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
    triggerEventId: (params.triggerEvent as any)?.id,
    triggerEventType: (params.triggerEvent as any)?.type,
    triggerEventChannel: (params.triggerEvent as any)?.channel,
    triggerEventCreatedAt: (params.triggerEvent as any)?.createdAt,
  })

  let saved: ContextItem
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

  const reactionShell: ContextItem = {
    id: reactionEventId,
    type: OUTPUT_ITEM_TYPE,
    channel:
      typeof params.triggerEvent?.channel === "string"
        ? params.triggerEvent.channel
        : WEB_CHANNEL,
    createdAt: new Date().toISOString(),
    status: "pending",
    content: {
      parts: [],
    },
  }

  let savedReaction: ContextItem
  try {
    savedReaction = await store.saveItem(params.contextIdentifier, reactionShell)
    savedReaction = await store.updateItem(savedReaction.id, {
      ...savedReaction,
      status: "pending",
    })
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:saveReaction:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
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
      savedReaction.id,
    )
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:createExecution:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
      triggerEventId: saved.id,
      reactionEventId: savedReaction.id,
      error: summarizeStepError(error),
    })
    throw error
  }

  try {
    await store.linkItemToExecution({
      itemId: saved.id,
      executionId: execution.id,
    })
    await store.linkItemToExecution({
      itemId: savedReaction.id,
      executionId: execution.id,
    })
  } catch (error) {
    logStepDebug("saveTriggerAndCreateExecution:linkItemsToExecution:error", {
      contextIdentifier: summarizeContextIdentifierForLog(params.contextIdentifier),
      triggerEventId: saved.id,
      reactionEventId: savedReaction.id,
      executionId: execution.id,
      error: summarizeStepError(error),
    })
    throw error
  }

  const { runId, meta } = await resolveWorkflowRunId({
    env,
    db,
    executionId: execution.id,
  })

  if (runId && db) {
    try {
      await db.transact([
        db.tx.event_executions[execution.id].update({
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

    const events: ContextTraceEventWrite[] = [
      {
        workflowRunId: runId,
        eventId: `workflow_run:${String(runId)}`,
        eventKind: "workflow.run",
        eventAt: new Date().toISOString(),
        payload: meta ?? null,
      },
      {
        workflowRunId: runId,
        eventId: `context_run:${String(execution.id)}`,
        eventKind: "context.run",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(execution.id),
        payload: {
          contextKey: contextKey ?? null,
          contextId: contextId ?? null,
          triggerEventId: saved.id,
          reactionEventId: savedReaction.id,
          workflowMeta: meta ?? null,
        },
      },
      {
        workflowRunId: runId,
        eventId: `context_execution:${String(execution.id)}`,
        eventKind: "context.execution",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(execution.id),
        payload: {
          status: "started",
        },
      },
      {
        workflowRunId: runId,
        eventId: `context_item:${String(saved.id)}`,
        eventKind: "context.item",
        eventAt: new Date().toISOString(),
        contextId,
        contextEventId: String(saved.id),
        payload: {
          ...saved,
          direction: "inbound",
        },
      },
      {
        workflowRunId: runId,
        eventId: `context_item:${String(savedReaction.id)}`,
        eventKind: "context.item",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(execution.id),
        contextEventId: String(savedReaction.id),
        payload: {
          ...savedReaction,
          direction: "outbound",
        },
      },
    ]

    await maybeWriteTraceEvents(env, events)
  }

  return {
    triggerEvent: saved,
    reactionEvent: savedReaction,
    execution: {
      id: execution.id,
      status: "executing",
    },
  }
}

export async function saveReactionItem(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    event: ContextItem
    opts?: {
      executionId?: string
      contextId?: string
      reviewRequests?: ContextReviewRequest[]
    }
  },
): Promise<ContextItem> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  const saved = await store.saveItem(params.contextIdentifier, params.event)
  if (params.opts?.executionId) {
    await store.linkItemToExecution({
      itemId: saved.id,
      executionId: params.opts.executionId,
    })
  }
  const contextId =
    params.opts?.contextId ??
    (typeof (params.contextIdentifier as any)?.id === "string"
      ? String((params.contextIdentifier as any).id)
      : undefined)

  const { runId, meta } = await resolveWorkflowRunId({
    env,
    db,
    executionId: params.opts?.executionId,
  })

  if (runId) {
    const events: ContextTraceEventWrite[] = [
      {
        workflowRunId: runId,
        eventId: `context_item:${String(saved.id)}`,
        eventKind: "context.item",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: params.opts?.executionId,
        contextEventId: String(saved.id),
        payload: {
          ...saved,
          direction: "outbound",
        },
      },
    ]

    if (params.opts?.executionId && params.opts.reviewRequests?.length) {
      const resumeHookUrl = getClientResumeHookUrl()
      const workflowUrl =
        meta && typeof meta.url === "string" && meta.url.trim()
          ? String(meta.url)
          : undefined
      for (const rr of params.opts.reviewRequests) {
        const toolCallId = String(rr.toolCallId)
        events.push({
          workflowRunId: runId,
          eventId: `context_review:${String(params.opts.executionId)}:${toolCallId}`,
          eventKind: "context.review",
          eventAt: new Date().toISOString(),
          contextId,
          executionId: String(params.opts.executionId),
          toolCallId,
          payload: {
            status: "in_review",
            toolName: rr.toolName ?? "",
            hookToken: toolApprovalHookToken({
              executionId: String(params.opts.executionId),
              toolCallId,
            }),
            webhookToken: toolApprovalWebhookToken({
              executionId: String(params.opts.executionId),
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
  params: RuntimeParams & {
    eventId: string
    event: ContextItem
    opts?: { executionId?: string; contextId?: string }
  },
): Promise<ContextItem> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  const saved = await store.updateItem(params.eventId, params.event)

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId: params.opts?.executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `context_item:${String(saved.id)}`,
        eventKind: "context.item",
        eventAt: new Date().toISOString(),
        contextId: params.opts?.contextId,
        executionId: params.opts?.executionId,
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
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    triggerEventId: string
    reactionEventId: string
  },
): Promise<{ id: string }> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  return await runtime.store.createExecution(
    params.contextIdentifier,
    params.triggerEventId,
    params.reactionEventId,
  )
}

export async function createReactionItem(params: {
  runtime: ContextRuntime<ContextEnvironment>
  contextIdentifier: ContextIdentifier
  triggerEventId: string
}): Promise<{ reactionEventId: string; executionId: string }> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  const { store } = runtime

  // Generate a new reaction event id inside the step boundary.
  const uuid = (globalThis.crypto as any)?.randomUUID?.()
  const reactionEventId =
    typeof uuid === "string"
      ? uuid
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const execution = await store.createExecution(
    params.contextIdentifier,
    params.triggerEventId,
    reactionEventId,
  )

  return { reactionEventId, executionId: execution.id }
}

export async function completeExecution(
  params: RuntimeParams & {
    contextIdentifier: ContextIdentifier
    executionId: string
    status: "completed" | "failed"
  },
): Promise<void> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  await store.completeExecution(params.contextIdentifier, params.executionId, params.status)
  const contextId =
    typeof (params.contextIdentifier as any)?.id === "string"
      ? String((params.contextIdentifier as any).id)
      : undefined

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId: params.executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `context_execution:${String(params.executionId)}:${params.status}`,
        eventKind: "context.execution",
        eventAt: new Date().toISOString(),
        contextId,
        executionId: String(params.executionId),
        payload: {
          status: params.status,
        },
      },
    ])
  }
}

export async function updateExecutionWorkflowRun(params: {
  runtime: ContextRuntime<ContextEnvironment>
  executionId: string
  workflowRunId: string
}): Promise<void> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  const db: any = runtime.db
  if (db) {
    await db.transact([
      db.tx.event_executions[params.executionId].update({
        workflowRunId: params.workflowRunId,
        updatedAt: new Date(),
      }),
    ])
  }
}

export async function createContextStep(params: {
  runtime: ContextRuntime<ContextEnvironment>
  executionId: string
  iteration: number
}): Promise<{ stepId: string }> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  const { store } = runtime
  const res = await store.createStep({
    executionId: params.executionId,
    iteration: params.iteration,
  })
  return { stepId: res.id }
}

export async function updateContextStep(params: {
  runtime: ContextRuntime<ContextEnvironment>
  stepId: string
  executionId?: string
  contextId?: string
  iteration?: number
  patch: {
    status?: "running" | "completed" | "failed"
    kind?: "message" | "action_execute" | "action_result"
    actionName?: string
    actionInput?: unknown
    actionOutput?: unknown
    actionError?: string
    actionRequests?: any
    actionResults?: any
    continueLoop?: boolean
    errorText?: string
  }
}): Promise<void> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  await store.updateStep(params.stepId, {
    ...(params.patch as any),
    updatedAt: new Date(),
  })

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId: params.executionId,
  })
  if (runId) {
    await maybeWriteTraceEvents(env, [
      {
        workflowRunId: runId,
        eventId: `context_step:${String(params.stepId)}`,
        eventKind: "context.step",
        eventAt: new Date().toISOString(),
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: String(params.stepId),
        payload: {
          status: params.patch.status,
          kind: params.patch.kind,
          actionName: params.patch.actionName,
          actionInput: params.patch.actionInput,
          actionOutput: params.patch.actionOutput,
          actionError: params.patch.actionError,
          iteration: params.iteration,
          actionRequests: params.patch.actionRequests,
          actionResults: params.patch.actionResults,
          continueLoop: params.patch.continueLoop,
          errorText: params.patch.errorText,
        },
      },
    ])
  }
}

export async function linkItemToExecutionStep(params: {
  runtime: ContextRuntime<ContextEnvironment>
  itemId: string
  executionId: string
}): Promise<void> {
  "use step"
  const { runtime } = await getRuntimeAndEnv(params)
  const { store } = runtime
  await store.linkItemToExecution({ itemId: params.itemId, executionId: params.executionId })
}

export async function saveContextPartsStep(params: {
  runtime: ContextRuntime<ContextEnvironment>
  stepId: string
  executionId?: string
  contextId?: string
  iteration?: number
  parts: any[]
}): Promise<void> {
  "use step"
  const { runtime, env } = await getRuntimeAndEnv(params)
  const { store, db } = runtime
  await store.saveStepParts({ stepId: params.stepId, parts: params.parts })

  const { runId } = await resolveWorkflowRunId({
    env,
    db,
    executionId: params.executionId,
  })
  if (runId && params.parts?.length) {
    const events: ContextTraceEventWrite[] = []
    for (let idx = 0; idx < params.parts.length; idx += 1) {
      const part = params.parts[idx]
      events.push({
        workflowRunId: runId,
        eventId: `context_part:${String(params.stepId)}:${idx}`,
        eventKind: "context.part",
        eventAt: new Date().toISOString(),
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: String(params.stepId),
        partKey: `${String(params.stepId)}:${idx}`,
        partIdx: idx,
        payload: part,
      })
    }
    await maybeWriteTraceEvents(env, events)
  }
}


