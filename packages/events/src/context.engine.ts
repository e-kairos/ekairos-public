import type { ModelMessage, UIMessageChunk } from "ai"
import type { DomainSchemaResult } from "@ekairos/domain"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextTool } from "./context.action.js"
import type {
  ContextRuntime,
  ContextRuntimeHandleForDomain,
  ContextRuntimeForDomain,
} from "./context.runtime.js"
import { getContextRuntimeServices } from "./context.runtime.js"
import { eventsDomain } from "./schema.js"
import type {
  ContextExecution,
  ContextItem,
  ContextIdentifier,
  StoredContext,
} from "./context.store.js"
import { OUTPUT_ITEM_TYPE, WEB_CHANNEL } from "./context.events.js"
import { applyToolExecutionResultToParts } from "./context.toolcalls.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
} from "./context.parts.js"
import type { ContextStreamEvent } from "./context.stream.js"

import type { ContextSkillPackage } from "./context.skill.js"
import {
  createAiSdkReactor,
  type ContextReactor,
} from "./context.reactor.js"
import {
  abortPersistedContextStepStream,
  closeContextStream,
  createPersistedContextStepStreamForRuntime,
  finalizePersistedContextStepStreamForRuntime,
  type PersistedContextStepStreamSession,
} from "./steps/stream.steps.js"
import {
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
} from "./context.step-stream.js"
import { resolveContextPartChunkIdentity } from "./context.part-identity.js"
import {
  completeExecution,
  createContextStep,
  finalizeReactionStep,
  getContextItems,
  initializeContext,
  openReactionStep,
  saveTriggerAndCreateExecution,
  saveContextPartsAndUpdateReaction,
  saveContextPartsStep,
  updateContextContent,
  updateContextReactor,
  updateContextStatus,
  updateItem,
  updateContextStep,
} from "./steps/store.steps.js"
import {
  getClientResumeHookUrl,
  toolApprovalHookToken,
  toolApprovalWebhookToken,
} from "./context.hooks.js"
import { getContextDurableWorkflow } from "./context.durable.js"

export interface ContextOptions<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> {
  onContextCreated?: (args: {
    env: Env
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
    context: StoredContext<Context>
  }) => void | Promise<void>
  onContextUpdated?: (args: {
    env: Env
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
    context: StoredContext<Context>
  }) => void | Promise<void>
  onEventCreated?: (event: ContextItem) => void | Promise<void>
  onActionExecuted?: (executionEvent: any) => void | Promise<void>
  onEnd?: (
    lastEvent: ContextItem,
  ) => void | boolean | Promise<void | boolean>
}

type BuilderSkills<Context, Env extends ContextEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<ContextSkillPackage[]> | ContextSkillPackage[]

type ContextBenchmarkRecorder = {
  measure<T>(name: string, run: () => Promise<T> | T): Promise<T>
  add?(name: string, value: number): void
  getCurrentStage?(): string | undefined
}

export async function runContextReactionDirect<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
>(
  context: ContextEngine<Context, Env, RequiredDomain>,
  triggerEvent: ContextItem,
  params: ContextReactParams<Env, RequiredDomain, Runtime>,
): Promise<ContextReactResult<Context>> {
  return await ContextEngine.runDirect(context, triggerEvent, params)
}

export interface ContextStreamOptions {
  /**
   * Maximum loop iterations (LLM call → tool execution → repeat).
   * Default: 20
   */
  maxIterations?: number

  /**
   * Maximum model steps per LLM call.
   * Default: 1 (or 5 if you override it in your implementation).
   */
  maxModelSteps?: number

  /**
   * If true, we do not close the workflow writable stream.
   * Default: false.
   */
  preventClose?: boolean

  /**
   * If true, we write a `finish` chunk to the workflow stream.
   * Default: true.
   */
  sendFinish?: boolean

  /**
   * If true, the story loop runs silently (no UI streaming output).
   *
   * Persistence (contexts/events/executions) still happens normally.
   *
   * Default: false.
   */
  silent?: boolean

  /**
   * Optional writable stream used by direct/non-durable execution.
   *
   * Durable execution owns its workflow stream and will reject custom writables.
   */
  writable?: WritableStream<UIMessageChunk>
}

/**
 * Model initializer (DurableAgent-style).
 *
 * - `string`: Vercel AI Gateway model id (e.g. `"openai/gpt-5"`), resolved inside the LLM step.
 * - `function`: a function that returns a model instance. For Workflow compatibility, this should
 *   be a `"use-step"` function (so it can be serialized by reference).
 */
export type ContextModelInit = string | (() => Promise<any>)

export type ContextReactParams<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = {
  runtime: ContextRuntimeForDomain<Runtime, RequiredDomain>
  /**
   * Context selector (exclusive: `{ id }` OR `{ key }`).
   * - `{ id }` resolves a concrete context id.
   * - `{ key }` resolves by `context.key`.
   * If omitted/null, the story will create a new context.
   */
  context?: ContextIdentifier | null
  durable?: boolean
  options?: ContextStreamOptions
  /**
   * Internal bootstrap used by the workflow-owned continuation path.
   * Not part of the public API surface.
   */
  __bootstrap?: {
    contextId: string
    trigger: ContextItem
    reaction: ContextItem
    execution: ContextExecution
  }
  __benchmark?: ContextBenchmarkRecorder
}

export type ContextDurableReactParams<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = Omit<ContextReactParams<Env, RequiredDomain, Runtime>, "durable"> & {
  durable?: true | undefined
}

export type ContextDirectReactParams<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = Omit<ContextReactParams<Env, RequiredDomain, Runtime>, "durable"> & {
  durable: false
}

async function resolveReactRuntime<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
  Runtime extends ContextRuntime<Env>,
>(
  params: ContextReactParams<Env, RequiredDomain, Runtime>,
): Promise<ContextRuntimeForDomain<Runtime, RequiredDomain>> {
  if (params.runtime) return params.runtime
  throw new Error("ContextEngine.react requires runtime.")
}

export type ContextReactBase<Context = any> = {
  context: StoredContext<Context>
  trigger: ContextItem
  reaction: ContextItem
  execution: ContextExecution
}

export type ContextReactFinalResult<Context = any> = ContextReactBase<Context>

export type ContextDirectRun<Context = any> = Promise<ContextReactFinalResult<Context>>

export type ContextWorkflowRun<Context = any> = {
  runId: string
  status: Promise<"pending" | "running" | "completed" | "failed" | "cancelled">
  returnValue: Promise<ContextReactFinalResult<Context>>
}

export type ContextReactRun<Context = any> =
  | ContextWorkflowRun<Context>
  | ContextDirectRun<Context>

export type ContextReactResult<
  Context = any,
  Run extends ContextReactRun<Context> = ContextReactRun<Context>,
> = ContextReactBase<Context> & {
  run?: Run
}

export type ContextDurableWorkflowPayload<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = {
  contextKey: string
  runtime: ContextRuntimeForDomain<Runtime, RequiredDomain>
  context?: ContextIdentifier | null
  triggerEvent: ContextItem
  options?: Omit<ContextStreamOptions, "writable">
  bootstrap: NonNullable<ContextReactParams<Env, RequiredDomain, Runtime>["__bootstrap"]>
}

export type ContextDurableWorkflowFunction<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = (
  payload: ContextDurableWorkflowPayload<Env, RequiredDomain, Runtime>,
) => Promise<ContextReactFinalResult<Context>>

export type ContextToolExecuteContext<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = {
  runtime: ContextRuntimeForDomain<Runtime, RequiredDomain>
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  toolCallId: string
  messages: ModelMessage[]
  eventId: string
  executionId: string
  triggerEventId: string
  contextId: string
  stepId: string
  iteration: number
  contextStepStream?: WritableStream<string>
}

/**
 * Payload expected to resume an auto=false tool execution.
 *
 * This must be serializable because it crosses the workflow hook boundary.
 *
 * See: https://useworkflow.dev/docs/foundations/hooks
 */
type ContextToolApprovalPayload =
  | { approved: true; comment?: string; args?: Record<string, unknown> }
  | { approved: false; comment?: string }

export { toolApprovalHookToken, toolApprovalWebhookToken, getClientResumeHookUrl }

/**
 * Context-level tool type.
 *
 * Allows contexts to attach metadata to actions/tools (e.g. `{ auto: false }`)
 * while remaining compatible with the AI SDK `Tool` runtime shape.
 *
 * Default behavior when omitted: `auto === true`.
 */
/**
 * ## Context loop continuation signal
 *
 * This hook result is intentionally a **boolean** so stories can be extremely declarative:
 *
 * - `return true`  => **continue** the durable loop
 * - `return false` => **finalize** the durable loop
 *
 * (No imports required in callers.)
 */
export type ShouldContinue = boolean

export type ContextShouldContinueArgs<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = {
  env: Env
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
  context: StoredContext<Context>
  /**
   * The persisted reaction event **so far** for the current streaming run.
   *
   * This contains the assistant's streamed parts as well as merged tool execution
   * outcomes (e.g. `state: "output-available"` / `"output-error"`).
   *
   * Stories can inspect `reactionEvent.content.parts` to determine stop conditions
   * (for example: when `tool-end` has an `output-available` state).
   */
  reactionEvent: ContextItem
  assistantEvent: ContextItem
  actionRequests: Array<{
    actionRef: string
    actionName: string
    input: unknown
  }>
  actionResults: Array<{
    actionRequest: {
      actionRef: string
      actionName: string
      input: unknown
    }
    success: boolean
    output: any
    errorText?: string
  }>
}

function nowIso() {
  return new Date().toISOString()
}

function clipPreview(value: string, max = 240): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

function summarizePartPreview(part: unknown): {
  partPreview?: string
  partState?: string
  partToolCallId?: string
} {
  if (!part || typeof part !== "object") return {}
  if (isContextPartEnvelope(part)) {
    const preview =
      part.type === "message"
        ? part.content.text ?? JSON.stringify(part.content.blocks?.[0] ?? part)
        : part.type === "reasoning"
          ? part.content.text
          : part.type === "source"
            ? JSON.stringify(part.content.sources[0] ?? part)
            : part.content.status === "failed"
              ? part.content.error.message
              : JSON.stringify(part.content)
    const state =
      part.type === "reasoning"
        ? part.content.state
        : part.type === "action"
          ? part.content.status
          : undefined
    const toolCallId = part.type === "action" ? part.content.actionCallId : undefined
    return {
      partPreview: preview ? clipPreview(preview) : undefined,
      partState: state,
      partToolCallId: toolCallId,
    }
  }
  const row = part as Record<string, unknown>
  const partType = typeof row.type === "string" ? row.type : ""
  const partState = typeof row.state === "string" ? row.state : undefined
  const partToolCallId =
    typeof row.toolCallId === "string"
      ? row.toolCallId
      : typeof row.id === "string"
        ? row.id
        : undefined

  if (typeof row.text === "string" && row.text.trim().length > 0) {
    return {
      partPreview: clipPreview(row.text),
      partState,
      partToolCallId,
    }
  }

  if (partType.startsWith("tool-")) {
    const payload = {
      tool: partType,
      state: partState,
      input: row.input,
      output: row.output,
      errorText: row.errorText,
    }
    return {
      partPreview: clipPreview(JSON.stringify(payload)),
      partState,
      partToolCallId,
    }
  }

  return {
    partState,
    partToolCallId,
  }
}

async function emitContextEvents(params: {
  silent: boolean
  writable?: WritableStream<UIMessageChunk>
  events: ContextStreamEvent[]
}) {
  void params
}

function toJsonSafeRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "undefined") return undefined
  try {
    const json = JSON.parse(JSON.stringify(value)) as unknown
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : { value: json }
  } catch {
    return undefined
  }
}

async function writeActionResultPartChunks(params: {
  session?: PersistedContextStepStreamSession | null
  writable?: WritableStream<UIMessageChunk>
  silent?: boolean
  contextId: string
  executionId: string
  itemId: string
  actionResults: Array<{
    actionRequest: {
      actionRef: string
      actionName: string
      input: unknown
    }
    success: boolean
    output: unknown
    errorText?: string
  }>
}) {
  if (!params.session || params.actionResults.length === 0) return

  const writer = params.session.stream.getWriter()
  const events: ContextStreamEvent[] = []
  const sequenceBase = Date.now()

  try {
    for (let index = 0; index < params.actionResults.length; index += 1) {
      const result = params.actionResults[index]!
      const actionRef = String(result.actionRequest.actionRef || "")
      const actionName = String(result.actionRequest.actionName || "")
      if (!actionRef || !actionName) continue

      const chunkType = result.success
        ? "chunk.action_output_available"
        : "chunk.action_output_error"
      const identity = resolveContextPartChunkIdentity({
        stepId: params.session.stepId,
        provider: "ekairos",
        providerPartId: actionRef,
        chunkType,
      })
      if (!identity) continue

      const data = result.success
        ? {
            toolCallId: actionRef,
            toolName: actionName,
            output: toJsonSafeRecord(result.output),
          }
        : {
            toolCallId: actionRef,
            toolName: actionName,
            error: {
              message: String(result.errorText || "Action failed."),
            },
          }

      const at = nowIso()
      const sequence = sequenceBase + index
      const persistedChunk = createContextStepStreamChunk({
        at,
        sequence,
        chunkType,
        stepId: params.session.stepId,
        partId: identity.partId,
        providerPartId: identity.providerPartId,
        partType: identity.partType,
        partSlot: identity.partSlot,
        provider: "ekairos",
        providerChunkType: result.success
          ? "action_output_available"
          : "action_output_error",
        actionRef,
        data,
      })

      await writer.write(encodeContextStepStreamChunk(persistedChunk, {
        stepId: params.session.stepId,
      }))

      events.push({
        type: "chunk.emitted",
        at,
        chunkType,
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: params.session.stepId,
        itemId: params.itemId,
        sequence,
        provider: "ekairos",
        providerChunkType: result.success
          ? "action_output_available"
          : "action_output_error",
        actionRef,
        partId: identity.partId,
        providerPartId: identity.providerPartId,
        partType: identity.partType,
        partSlot: identity.partSlot,
        data,
      })
    }
  } finally {
    if (typeof (writer as any)?.releaseLock === "function") {
      writer.releaseLock()
    }
  }

  if (events.length > 0) {
    await emitContextEvents({
      silent: params.silent ?? false,
      writable: params.writable,
      events,
    })
  }
}

async function measureBenchmark<T>(
  benchmark: ContextBenchmarkRecorder | undefined,
  name: string,
  run: () => Promise<T> | T,
): Promise<T> {
  if (!benchmark) return await run()
  return await benchmark.measure(name, run)
}

async function readActiveWorkflowRunId() {
  try {
    const { getWorkflowMetadata } = await import("workflow")
    const runId = getWorkflowMetadata?.()?.workflowRunId
    return runId ? String(runId) : null
  } catch {
    return null
  }
}

type ContextStepPatch = {
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

type ContextEngineOps<Context> = {
  initializeContext: (
    contextIdentifier: ContextIdentifier | null,
    opts?: { silent?: boolean },
  ) => Promise<{ context: StoredContext<Context>; isNew: boolean }>
  updateContextContent: (
    contextIdentifier: ContextIdentifier,
    content: Context,
  ) => Promise<StoredContext<Context>>
  updateContextReactor: (
    contextIdentifier: ContextIdentifier,
    reactor: { kind: string; state?: Record<string, unknown> | null },
  ) => Promise<StoredContext<Context>>
  updateContextStatus: (
    contextIdentifier: ContextIdentifier,
    status: "open_idle" | "open_streaming" | "closed",
  ) => Promise<void>
  getItems: (contextIdentifier: ContextIdentifier) => Promise<ContextItem[]>
  saveTriggerAndCreateExecution: (params: {
    contextIdentifier: ContextIdentifier
    triggerEvent: ContextItem
  }) => Promise<{
    triggerEvent: ContextItem
    reactionEvent: ContextItem
    execution: ContextExecution
  }>
  openReactionStep: (params: {
    contextIdentifier: ContextIdentifier
    content: Context
    executionId: string
    iteration: number
  }) => Promise<{
    stepId: string
    stream: PersistedContextStepStreamSession
    context: StoredContext<Context>
    events: ContextItem[]
  }>
  createContextStep: (params: {
    executionId: string
    iteration: number
  }) => Promise<{ stepId: string }>
  updateContextStep: (params: {
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    patch: ContextStepPatch
  }) => Promise<void>
  finalizeReactionStep: (params: {
    session?: PersistedContextStepStreamSession | null
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    patch: ContextStepPatch
    reactionEventId?: string
    reactionEvent?: ContextItem
  }) => Promise<{ reactionEvent?: ContextItem }>
  saveContextPartsStep: (params: {
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    parts: any[]
  }) => Promise<void>
  saveContextPartsAndUpdateReaction: (params: {
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    parts: any[]
    reactionEventId: string
    reactionEvent: ContextItem
  }) => Promise<{ reactionEvent: ContextItem }>
  updateItem: (
    itemId: string,
    item: ContextItem,
    opts?: { executionId?: string; contextId?: string },
  ) => Promise<ContextItem>
  completeExecution: (
    contextIdentifier: ContextIdentifier,
    executionId: string,
    status: "completed" | "failed",
  ) => Promise<void>
}

async function createRuntimeOps<Context>(
  runtimeHandle: ContextRuntime<any>,
  benchmark?: ContextBenchmarkRecorder,
): Promise<ContextEngineOps<Context> & { db: any }> {
  const runtime = await getContextRuntimeServices(runtimeHandle)
  const { db } = runtime
  const { InstantStore } = await import("./stores/instant.store.js")
  const requireContextId = (contextIdentifier: ContextIdentifier) => {
    if ("id" in contextIdentifier && typeof contextIdentifier.id === "string" && contextIdentifier.id) {
      return String(contextIdentifier.id)
    }
    throw new Error("ContextEngine direct runtime requires resolved context ids.")
  }
  const makeRuntimeId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const instrumentAsync = async <T>(
    kind: "query" | "transact",
    run: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = Date.now()
    try {
      return await run()
    } finally {
      const elapsedMs = Date.now() - startedAt
      benchmark?.add?.("react.network.totalMs", elapsedMs)
      benchmark?.add?.(`react.network.${kind}Ms`, elapsedMs)
      benchmark?.add?.(`react.network.${kind}Count`, 1)
      const currentStage = benchmark?.getCurrentStage?.()
      if (currentStage) {
        benchmark?.add?.(`${currentStage}.networkMs`, elapsedMs)
        benchmark?.add?.(`${currentStage}.${kind}Count`, 1)
      }
    }
  }
  const instrumentedDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return async (...args: any[]) =>
          await instrumentAsync("query", async () => await target.query(...args))
      }
      if (prop === "transact") {
        return async (...args: any[]) =>
          await instrumentAsync("transact", async () => await target.transact(...args))
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  const store = new InstantStore(instrumentedDb)

  return {
    db: instrumentedDb,
    initializeContext: async (contextIdentifier) => {
      if (!contextIdentifier) {
        const context = await store.getOrCreateContext<Context>(null)
        return { context, isNew: true }
      }
      const existing = await store.getContext<Context>(contextIdentifier)
      if (existing) {
        return { context: existing, isNew: false }
      }
      const context = await store.getOrCreateContext<Context>(contextIdentifier)
      return { context, isNew: true }
    },
    updateContextContent: async (contextIdentifier, content) =>
      await store.updateContextContent(contextIdentifier, content),
    updateContextReactor: async (contextIdentifier, reactor) =>
      await store.updateContextReactor(contextIdentifier, reactor),
    updateContextStatus: async (contextIdentifier, status) =>
      await instrumentedDb.transact([
        instrumentedDb.tx.event_contexts[requireContextId(contextIdentifier)].update({
          status,
          updatedAt: new Date(),
        }),
      ]),
    saveTriggerAndCreateExecution: async ({ contextIdentifier, triggerEvent }) => {
      const contextId = requireContextId(contextIdentifier)
      const triggerId = String(triggerEvent.id)
      const reactionId = makeRuntimeId()
      const executionId = makeRuntimeId()
      const reactionEvent: ContextItem = {
        id: reactionId,
        type: OUTPUT_ITEM_TYPE,
        channel:
          typeof triggerEvent.channel === "string"
            ? triggerEvent.channel
            : WEB_CHANNEL,
        createdAt: new Date().toISOString(),
        status: "pending",
        content: { parts: [] },
      }
      const now = new Date()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[triggerId].update({
          ...(triggerEvent as any),
          id: triggerId,
          status: "stored",
        }),
        instrumentedDb.tx.event_items[triggerId].link({ context: contextId }),
        instrumentedDb.tx.event_items[reactionId].update({
          ...(reactionEvent as any),
          id: reactionId,
          status: "pending",
        }),
        instrumentedDb.tx.event_items[reactionId].link({ context: contextId }),
        instrumentedDb.tx.event_executions[executionId].create({
          createdAt: now,
          updatedAt: now,
          status: "executing",
        }),
        instrumentedDb.tx.event_executions[executionId].link({ context: contextId }),
        instrumentedDb.tx.event_executions[executionId].link({ trigger: triggerId }),
        instrumentedDb.tx.event_executions[executionId].link({ reaction: reactionId }),
        instrumentedDb.tx.event_items[triggerId].link({ execution: executionId }),
        instrumentedDb.tx.event_items[reactionId].link({ execution: executionId }),
        instrumentedDb.tx.event_contexts[contextId].update({
          status: "open_streaming",
          updatedAt: now,
        }),
        instrumentedDb.tx.event_contexts[contextId].link({ currentExecution: executionId }),
      ])
      return {
        triggerEvent: {
          ...triggerEvent,
          id: triggerId,
          status: "stored",
        },
        reactionEvent,
        execution: {
          id: executionId,
          status: "executing",
        },
      }
    },
    openReactionStep: async ({ contextIdentifier, content, executionId, iteration }) => {
      const stepId = makeRuntimeId()
      const now = new Date()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[stepId].create({
          createdAt: now,
          updatedAt: now,
          status: "running",
          iteration,
        }),
        instrumentedDb.tx.event_steps[stepId].link({ execution: executionId }),
      ])
      const stream = await createPersistedContextStepStreamForRuntime(
        { db: instrumentedDb },
        {
          executionId,
          stepId,
        },
      )
      const context = await store.updateContextContent(contextIdentifier, content)
      const events = await store.getItems(contextIdentifier)

      return {
        stepId,
        stream,
        context,
        events,
      }
    },
    createContextStep: async ({ executionId, iteration }) => {
      const stepId = makeRuntimeId()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[stepId].create({
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "running",
          iteration,
        }),
        instrumentedDb.tx.event_steps[stepId].link({ execution: executionId }),
      ])
      return { stepId }
    },
    updateContextStep: async (params) => {
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[params.stepId].update({
          ...(params.patch as any),
          updatedAt: new Date(),
        }),
      ])
    },
    finalizeReactionStep: async (params) => {
      if (params.session) {
        await finalizePersistedContextStepStreamForRuntime({
          runtime: { db: instrumentedDb },
          session: params.session,
          mode: "close",
        })
      }

      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[params.stepId].update({
          ...(params.patch as any),
          updatedAt: new Date(),
        }),
      ])

      if (!params.reactionEventId || !params.reactionEvent) {
        return {}
      }

      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[params.reactionEventId].update(
          params.reactionEvent as any,
        ),
      ])

      return {
        reactionEvent: {
          ...(params.reactionEvent as any),
          id: params.reactionEventId,
        } as ContextItem,
      }
    },
    saveContextPartsStep: async (params) => {
      await store.saveStepParts({ stepId: params.stepId, parts: params.parts })
    },
    saveContextPartsAndUpdateReaction: async (params) => {
      await store.saveStepParts({ stepId: params.stepId, parts: params.parts })
      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[params.reactionEventId].update(
          params.reactionEvent as any,
        ),
      ])
      return {
        reactionEvent: {
          ...(params.reactionEvent as any),
          id: params.reactionEventId,
        } as ContextItem,
      }
    },
    getItems: async (contextIdentifier) => await store.getItems(contextIdentifier),
    updateItem: async (itemId, item) => {
      await instrumentedDb.transact([instrumentedDb.tx.event_items[itemId].update(item as any)])
      return {
        ...(item as any),
        id: itemId,
      } as ContextItem
    },
    completeExecution: async (contextIdentifier, executionId, status) => {
      const contextId = requireContextId(contextIdentifier)
      await instrumentedDb.transact([
        instrumentedDb.tx.event_executions[executionId].update({
          status,
          updatedAt: new Date(),
        }),
        instrumentedDb.tx.event_contexts[contextId].update({
          status: "closed",
          updatedAt: new Date(),
        }),
      ])
    },
  }
}

async function createWorkflowOps<Context>(
  runtime: ContextRuntime<any>,
): Promise<ContextEngineOps<Context>> {
  const env = runtime.env
  return {
    initializeContext: async (contextIdentifier, opts) =>
      await initializeContext<Context>({ runtime, contextIdentifier, opts }),
    updateContextContent: async (contextIdentifier, content) =>
      await updateContextContent<Context>({ runtime, contextIdentifier, content }),
    updateContextReactor: async (contextIdentifier, reactor) =>
      await updateContextReactor<Context>({ runtime, contextIdentifier, reactor }),
    updateContextStatus: async (contextIdentifier, status) =>
      await updateContextStatus({ runtime, contextIdentifier, status }),
    saveTriggerAndCreateExecution: async ({ contextIdentifier, triggerEvent }) =>
      await saveTriggerAndCreateExecution({ runtime, contextIdentifier, triggerEvent }),
    openReactionStep: async (params) =>
      await openReactionStep<Context>({ runtime, ...params }),
    createContextStep: async ({ executionId, iteration }) =>
      await createContextStep({ runtime, executionId, iteration }),
    updateContextStep: async (params) =>
      await updateContextStep({ runtime, ...params }),
    finalizeReactionStep: async (params) =>
      await finalizeReactionStep({ runtime, ...params }),
    saveContextPartsStep: async (params) =>
      await saveContextPartsStep({ runtime, ...params }),
    saveContextPartsAndUpdateReaction: async (params) =>
      await saveContextPartsAndUpdateReaction({ runtime, ...params }),
    getItems: async (contextIdentifier) =>
      await getContextItems({ runtime, contextIdentifier }),
    updateItem: async (itemId, item, opts) =>
      await updateItem({ runtime, eventId: itemId, event: item, opts }),
    completeExecution: async (contextIdentifier, executionId, status) =>
      await completeExecution({ runtime, contextIdentifier, executionId, status }),
  }
}

async function getContextEngineOps<Context>(
  runtime: ContextRuntime<any>,
  benchmark?: ContextBenchmarkRecorder,
) {
  const env = runtime.env
  const workflowRunId = await readActiveWorkflowRunId()
  if (workflowRunId) {
    return await createWorkflowOps<Context>(runtime)
  }

  return await createRuntimeOps<Context>(runtime, benchmark)
}

export abstract class ContextEngine<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> {
  private readonly reactor: ContextReactor<Context, Env, RequiredDomain>

  constructor(
    protected readonly opts: ContextOptions<Context, Env, RequiredDomain> = {},
    reactor?: ContextReactor<Context, Env, RequiredDomain>,
  ) {
    this.reactor =
      reactor ??
      (createAiSdkReactor<Context, Env>() as unknown as ContextReactor<Context, Env, RequiredDomain>)
  }

  protected abstract initialize(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<Context> | Context

  protected abstract buildSystemPrompt(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<string> | string

  protected abstract buildTools(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<Record<string, ContextTool<Context, Env, RequiredDomain>>> | Record<string, ContextTool<Context, Env, RequiredDomain>>

  protected async buildSkills(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<ContextSkillPackage[]> {
    return []
  }

  /**
   * First-class event expansion stage (runs on every iteration of the durable loop).
   *
   * Use this to expand/normalize events before they are converted into model messages.
   * Typical use-cases:
   * - Expand file/document references into text (LlamaCloud/Reducto/…)
   * - Token compaction / summarization of older parts
   * - Attaching derived context snippets to the next model call
   *
   * IMPORTANT:
   * - This stage is ALWAYS executed by the engine.
   * - If you don't provide an implementation, the default behavior is an identity transform
   *   (events pass through unchanged).
   * - If your implementation performs I/O, implement it as a `"use-step"` function (provided via
   *   the builder) so results are durable and replay-safe.
   * - If it’s pure/deterministic, it can run in workflow context.
   */
  protected async expandEvents(
    events: ContextItem[],
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<ContextItem[]> {
    return events
  }

  protected getModel(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): ContextModelInit {
    return "openai/gpt-5"
  }

  protected getReactor(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): ContextReactor<Context, Env, RequiredDomain> {
    return this.reactor
  }

  /**
   * Context stop/continue hook.
   *
   * After the model streamed and tools executed, the story can decide whether the loop should
   * continue.
   *
   * Default: `true` (continue).
   */
  protected async shouldContinue(
    _args: ContextShouldContinueArgs<Context, Env, RequiredDomain>,
  ): Promise<ShouldContinue> {
    return true
  }

  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDurableReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextWorkflowRun<Context>>>
  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDirectReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>>
  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context>>
  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context>> {
    if (params.durable === false) {
      return await ContextEngine.runDirect(this, triggerEvent, params)
    }
    return await ContextEngine.startDurable(this, triggerEvent, params)
  }

  private static async prepareExecutionShell<
    Context,
    Env extends ContextEnvironment,
    RequiredDomain extends DomainSchemaResult,
    Runtime extends ContextRuntime<Env>,
  >(
    story: ContextEngine<Context, Env, RequiredDomain>,
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ) {
    const runtimeHandle = await resolveReactRuntime(params)
    const env = (runtimeHandle as Runtime).env
    const ops = await measureBenchmark(
      params.__benchmark,
      "react.resolveOpsMs",
      async () => await getContextEngineOps<Context>(runtimeHandle as Runtime, params.__benchmark),
    )

    const silent = params.options?.silent ?? false
    const ctxResult = await measureBenchmark(
      params.__benchmark,
      "react.initializeContextMs",
      async () => await ops.initializeContext(params.context ?? null, { silent }),
    )
    let currentContext = ctxResult.context

    const contextSelector: ContextIdentifier = { id: String(currentContext.id) }

    if (ctxResult.isNew) {
      await story.opts.onContextCreated?.({
        env,
        runtime: runtimeHandle,
        context: currentContext,
      })
    }

    if (currentContext.status === "closed") {
      await measureBenchmark(
        params.__benchmark,
        "react.reopenClosedContextMs",
        async () => await ops.updateContextStatus(contextSelector, "open_idle"),
      )
      currentContext = { ...currentContext, status: "open_idle" }
    }

    const shell = await measureBenchmark(
      params.__benchmark,
      "react.bootstrapShellMs",
      async () =>
        await ops.saveTriggerAndCreateExecution({
          contextIdentifier: contextSelector,
          triggerEvent,
        }),
    )
    currentContext = { ...currentContext, status: "open_streaming" }

    return {
      runtimeHandle,
      contextSelector,
      currentContext,
      trigger: shell.triggerEvent,
      reaction: shell.reactionEvent,
      execution: shell.execution,
    }
  }

  private static async startDurable<
    Context,
    Env extends ContextEnvironment,
    RequiredDomain extends DomainSchemaResult,
    Runtime extends ContextRuntime<Env>,
  >(
    story: ContextEngine<Context, Env, RequiredDomain>,
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextWorkflowRun<Context>>> {
    const runtimeHandle = await resolveReactRuntime(params)
    const env = (runtimeHandle as Runtime).env
    if (params.options?.writable) {
      throw new Error("ContextEngine.react: durable runs manage their own workflow stream")
    }

    const contextKey =
      typeof (story as any).__contextKey === "string" ? String((story as any).__contextKey) : ""
    if (!contextKey) {
      throw new Error(
        "ContextEngine.react: durable mode requires a context built with createContext(...).build().",
      )
    }

    const workflow = getContextDurableWorkflow() as
      | ContextDurableWorkflowFunction<Context, Env, RequiredDomain, Runtime>
      | undefined

    if (typeof workflow !== "function") {
      throw new Error(
        "ContextEngine.react: durable workflow is not configured. Call configureContextDurableWorkflow(...) in runtime bootstrap.",
      )
    }

    const shell = await ContextEngine.prepareExecutionShell(story, triggerEvent, params)

    let run:
      | {
          runId: string
          status: Promise<"pending" | "running" | "completed" | "failed" | "cancelled">
          returnValue: Promise<ContextReactFinalResult<Context>>
        }
      | undefined

    try {
      const [{ start }] = await measureBenchmark(
        params.__benchmark,
        "react.durable.importWorkflowApiMs",
        async () =>
          await Promise.all([
            import("workflow/api"),
          ]),
      )

      const startedRun = await measureBenchmark(
        params.__benchmark,
        "react.durable.startWorkflowMs",
        async () =>
          await start(workflow, [
            {
              contextKey,
              runtime: runtimeHandle,
              context: params.context ?? null,
              triggerEvent,
              options: {
                maxIterations: params.options?.maxIterations,
                maxModelSteps: params.options?.maxModelSteps,
                preventClose: params.options?.preventClose,
                sendFinish: params.options?.sendFinish,
                silent: params.options?.silent,
              },
              bootstrap: {
                contextId: shell.currentContext.id,
                trigger: shell.trigger,
                reaction: shell.reaction,
                execution: shell.execution,
              },
            } satisfies ContextDurableWorkflowPayload<Env, RequiredDomain, Runtime>,
          ]),
      )

      run = {
        runId: String(startedRun.runId),
        status: startedRun.status as Promise<
          "pending" | "running" | "completed" | "failed" | "cancelled"
        >,
        returnValue: startedRun.returnValue as Promise<ContextReactFinalResult<Context>>,
      }

      const runtime = await measureBenchmark(
        params.__benchmark,
        "react.durable.resolveRuntimeOpsMs",
        async () => await createRuntimeOps<Context>(runtimeHandle as Runtime, params.__benchmark),
      )
      await measureBenchmark(
        params.__benchmark,
        "react.durable.persistWorkflowRunIdMs",
        async () =>
          await runtime.db.transact([
            runtime.db.tx.event_executions[shell.execution.id].update({
              workflowRunId: startedRun.runId,
              updatedAt: new Date(),
            }),
          ]),
      )
    } catch (error) {
      const ops = await getContextEngineOps<Context>(runtimeHandle as Runtime, params.__benchmark)
      await ops.completeExecution(shell.contextSelector, shell.execution.id, "failed").catch(() => null)
      throw error
    }

    return {
      context: shell.currentContext,
      trigger: shell.trigger,
      reaction: shell.reaction,
      execution: shell.execution,
      run,
    }
  }

  static async runDirect<
    Context,
    Env extends ContextEnvironment,
    RequiredDomain extends DomainSchemaResult,
    Runtime extends ContextRuntime<Env>,
  >(
    story: ContextEngine<Context, Env, RequiredDomain>,
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>> {
    if (!params.__bootstrap) {
      const shell = await ContextEngine.prepareExecutionShell(story, triggerEvent, params)
      const run: ContextDirectRun<Context> = ContextEngine.runDirect(story, triggerEvent, {
        ...params,
        runtime: shell.runtimeHandle,
        __bootstrap: {
          contextId: shell.currentContext.id,
          trigger: shell.trigger,
          reaction: shell.reaction,
          execution: shell.execution,
        },
      })

      return {
        context: shell.currentContext,
        trigger: shell.trigger,
        reaction: shell.reaction,
        execution: shell.execution,
        run,
      }
    }

    const runtimeHandle = await resolveReactRuntime(params)
    const env = (runtimeHandle as Runtime).env
    const ops = await measureBenchmark(
      params.__benchmark,
      "react.resolveOpsMs",
      async () => await getContextEngineOps<Context>(runtimeHandle as Runtime, params.__benchmark),
    )

    const maxIterations = params.options?.maxIterations ?? 20
    const maxModelSteps = params.options?.maxModelSteps ?? 1
    const preventClose = params.options?.preventClose ?? false
    const sendFinish = params.options?.sendFinish ?? true
    const silent = params.options?.silent ?? false
    const writable = params.options?.writable

    const bootstrapped = params.__bootstrap
    const shell = bootstrapped
      ? {
          contextSelector: { id: String(bootstrapped.contextId) } as ContextIdentifier,
          currentContext: (await measureBenchmark(
            params.__benchmark,
            "react.bootstrapContextLookupMs",
            async () =>
              await ops.initializeContext(
                { id: String(bootstrapped.contextId) },
                { silent },
              ),
          )).context,
          trigger: bootstrapped.trigger,
          reaction: bootstrapped.reaction,
          execution: bootstrapped.execution,
        }
      : await ContextEngine.prepareExecutionShell(story, triggerEvent, params)

    let currentContext = shell.currentContext
    let trigger = shell.trigger
    let reactionEvent: ContextItem = shell.reaction
    let execution: ContextExecution = shell.execution
    const activeContextSelector = shell.contextSelector

    const triggerEventId = trigger.id
    const reactionEventId = reactionEvent.id
    const executionId = execution.id

    let updatedContext: StoredContext<Context> = { ...currentContext, status: "open_streaming" }
    let currentStepId: string | null = null
    let currentStepStream: PersistedContextStepStreamSession | null = null

    const failExecution = async () => {
      try {
        await ops.completeExecution(activeContextSelector, executionId, "failed")
        execution = { ...execution, status: "failed" }
        updatedContext = { ...updatedContext, status: "closed" }
        await emitContextEvents({
          silent,
          writable,
          events: [
            {
              type: "execution.failed",
              at: nowIso(),
              executionId,
              contextId: String(currentContext.id),
              status: "failed",
            },
            {
              type: "context.status_changed",
              at: nowIso(),
              contextId: String(currentContext.id),
              status: "closed",
            },
          ],
        })
      } catch {
        // noop
      }
      try {
        if (!silent) {
          await closeContextStream({ preventClose, sendFinish, writable })
        }
      } catch {
        // noop
      }
    }

    try {
      for (let iter = 0; iter < maxIterations; iter++) {
        const stagePrefix = `react.iteration.${iter}`

        // Hook: Context DSL `context()` (implemented by subclasses via `initialize()`)
        const nextContent = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.contextMs`,
          async () => await story.initialize(updatedContext, env, runtimeHandle),
        )

        const openedStep = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.openReactionStepMs`,
          async () =>
            await ops.openReactionStep({
              contextIdentifier: activeContextSelector,
              content: nextContent,
              executionId,
              iteration: iter,
            }),
        )
        currentStepId = openedStep.stepId
        currentStepStream = openedStep.stream
        updatedContext = openedStep.context
        const rawEvents = openedStep.events

        await emitContextEvents({
          silent,
          writable,
          events: [
            {
              type: "step.created",
              at: nowIso(),
              stepId: String(openedStep.stepId),
              executionId,
              iteration: iter,
              status: "running",
            },
            {
              type: "context.content_updated",
              at: nowIso(),
              contextId: String(updatedContext.id),
            },
          ],
        })

        await story.opts.onContextUpdated?.({
          env,
          runtime: runtimeHandle,
          context: updatedContext,
        })

        // Hook: Context DSL `narrative()` (implemented by subclasses via `buildSystemPrompt()`)
        const systemPrompt = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.narrativeMs`,
          async () => await story.buildSystemPrompt(updatedContext, env, runtimeHandle),
        )

        // Hook: Context DSL `actions()` (implemented by subclasses via `buildTools()`)
        const toolsAll = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.actionsMs`,
          async () => await story.buildTools(updatedContext, env, runtimeHandle),
        )
        const skillsAll = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.skillsMs`,
          async () => await story.buildSkills(updatedContext, env, runtimeHandle),
        )
        const expandedEvents = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.expandEventsMs`,
          async () => await story.expandEvents(rawEvents, updatedContext, env, runtimeHandle),
        )

        // Execute model reaction for this iteration using the stable reaction event id.
        //
        // IMPORTANT:
        // We expose a single visible `context_event` per story turn (`reactionEventId`).
        // If we stream with a per-step id, the UI will render an optimistic assistant message
        // (step id) and then a second persisted assistant message (reaction id) with the same
        // content once InstantDB updates.
        const reactor = story.getReactor(updatedContext, env, runtimeHandle)
        const reactionPartsBeforeStep = Array.isArray(reactionEvent.content?.parts)
          ? [...reactionEvent.content.parts]
          : []
        let persistedReactionPartsSignature = ""
        const persistReactionParts = async (nextParts: any[]) => {
          const normalizedParts = normalizePartsForPersistence(
            Array.isArray(nextParts) ? nextParts : [],
          )
          const nextSignature = JSON.stringify(normalizedParts)
          if (nextSignature === persistedReactionPartsSignature) return
          persistedReactionPartsSignature = nextSignature

          const saved = await ops.saveContextPartsAndUpdateReaction({
            stepId: openedStep.stepId,
            parts: normalizedParts,
            reactionEventId: reactionEvent.id,
            reactionEvent: {
              ...reactionEvent,
              content: {
                ...reactionEvent.content,
                parts: [...reactionPartsBeforeStep, ...normalizedParts],
              },
              status: "pending",
            },
            executionId,
            contextId: String(currentContext.id),
            iteration: iter,
          })
          reactionEvent = saved.reactionEvent
        }
        const reactionResult = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.reactorMs`,
          async () =>
            await reactor({
              runtime: runtimeHandle,
              context: updatedContext,
              contextIdentifier: activeContextSelector,
              events: expandedEvents,
              triggerEvent,
              model: story.getModel(updatedContext, env, runtimeHandle),
              systemPrompt,
              actions: toolsAll,
              skills: skillsAll,
              eventId: reactionEventId,
              executionId,
              contextId: String(currentContext.id),
              stepId: String(openedStep.stepId),
              iteration: iter,
              maxModelSteps,
              // Only emit a `start` chunk once per story turn.
              sendStart: !silent && iter === 0,
              silent,
              contextStepStream: currentStepStream?.stream,
              writable,
              persistReactionParts,
            }),
        )
        const { assistantEvent, actionRequests, messagesForModel } = reactionResult

        const reviewRequests =
          actionRequests.length > 0
            ? (actionRequests as any[]).flatMap((actionRequest) => {
                const toolDef = (toolsAll as any)[actionRequest.actionName] as any
                const auto = toolDef?.auto !== false
                ;(actionRequest as any).auto = auto
                if (auto) return []
                return [
                  {
                    toolCallId: String(actionRequest.actionRef),
                    toolName: String(actionRequest.actionName ?? ""),
                  },
                ]
              })
            : []

        // Persist normalized parts hanging off the producing step (event_parts).
        // IMPORTANT:
        // We intentionally do NOT persist the per-step LLM assistant event as a `context_event`.
        // The story exposes a single visible `context_event` per turn (`reactionEventId`) so the UI
        // doesn't render duplicate assistant messages (LLM-step + aggregated reaction).
        const stepParts = normalizePartsForPersistence(
          ((((assistantEvent as any)?.content?.parts ?? []) as any[]) as any[]),
        )
        const assistantEventEffective: ContextItem = {
          ...assistantEvent,
          content: {
            ...((assistantEvent as any)?.content ?? {}),
            parts: stepParts,
          },
        }
        const nextAssistantParts = Array.isArray(assistantEventEffective.content?.parts)
          ? assistantEventEffective.content.parts
          : []
        const nextReactionEvent: ContextItem = {
          ...reactionEvent,
          content: {
            ...reactionEvent.content,
            parts: [...reactionPartsBeforeStep, ...nextAssistantParts],
          },
          status: "pending",
        }
        const appendedReactorOutput = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.appendReactorOutputMs`,
          async () =>
            await ops.saveContextPartsAndUpdateReaction({
              stepId: openedStep.stepId,
              parts: stepParts,
              reactionEventId: reactionEvent.id,
              reactionEvent: nextReactionEvent,
              executionId,
              contextId: String(currentContext.id),
              iteration: iter,
            }),
        )
        reactionEvent = appendedReactorOutput.reactionEvent
        await emitContextEvents({
          silent,
          writable,
          events: stepParts.map((part: any, idx: number) => ({
            type: "part.created" as const,
            at: nowIso(),
            partKey: `${String(openedStep.stepId)}:${idx}`,
            stepId: String(openedStep.stepId),
            idx,
            partType:
              part && typeof part.type === "string"
                ? String(part.type)
                : undefined,
            ...summarizePartPreview(part),
          })),
        })

        if (reactionResult.reactor?.kind) {
          updatedContext = await measureBenchmark(
            params.__benchmark,
            `${stagePrefix}.persistReactorStateMs`,
            async () =>
              await ops.updateContextReactor(activeContextSelector, {
                kind: reactionResult.reactor!.kind,
                state: {
                  ...(reactionResult.reactor!.state ?? {}),
                  updatedAt: nowIso(),
                },
              }),
          )
        }
        story.opts.onEventCreated?.(assistantEventEffective)

        const firstActionRequest = (actionRequests as any[])?.[0] as
          | { actionName?: string; actionRef?: string; input?: unknown }
          | undefined
        await emitContextEvents({
          silent,
          writable,
          events: [
            {
              type: "step.updated",
              at: nowIso(),
              stepId: String(openedStep.stepId),
              executionId,
              iteration: iter,
              status: "running",
              kind: firstActionRequest ? "action_execute" : "message",
              actionName:
                firstActionRequest && typeof firstActionRequest.actionName === "string"
                  ? firstActionRequest.actionName
                  : undefined,
            },
          ],
        })

        // Done: no tool calls requested by the model
        if (!actionRequests.length) {
          const endResult = await story.callOnEnd(assistantEventEffective)
          if (endResult) {
            const completedReactionEvent: ContextItem = {
              ...reactionEvent,
              status: "completed",
            }
            const finalized = await measureBenchmark(
              params.__benchmark,
              `${stagePrefix}.finalizeReactionStepMs`,
              async () =>
                await ops.finalizeReactionStep({
                  session: currentStepStream,
                  stepId: openedStep.stepId,
                  patch: {
                    status: "completed",
                    kind: "message",
                    actionRequests: [],
                    actionResults: [],
                    continueLoop: false,
                  },
                  reactionEventId,
                  reactionEvent: completedReactionEvent,
                  executionId,
                  contextId: String(currentContext.id),
                  iteration: iter,
                }),
            )
            currentStepStream = null
            reactionEvent = finalized.reactionEvent ?? completedReactionEvent
            await emitContextEvents({
              silent,
              writable,
              events: [
                {
                  type: "step.updated",
                  at: nowIso(),
                  stepId: String(openedStep.stepId),
                  executionId,
                  iteration: iter,
                  status: "completed",
                  kind: "message",
                },
                {
                  type: "step.completed",
                  at: nowIso(),
                  stepId: String(openedStep.stepId),
                  executionId,
                  iteration: iter,
                  status: "completed",
                },
              ],
            })

            await emitContextEvents({
              silent,
              writable,
              events: [
                {
                  type: "item.completed",
                  at: nowIso(),
                  itemId: String(reactionEventId),
                  contextId: String(currentContext.id),
                  executionId,
                  status: "completed",
                },
              ],
            })
            await measureBenchmark(
              params.__benchmark,
              `${stagePrefix}.completeExecutionMs`,
              async () => await ops.completeExecution(activeContextSelector, executionId, "completed"),
            )
            execution = { ...execution, status: "completed" }
            updatedContext = { ...updatedContext, status: "closed" }
            await emitContextEvents({
              silent,
              writable,
              events: [
                {
                  type: "execution.completed",
                  at: nowIso(),
                  executionId,
                  contextId: String(currentContext.id),
                  status: "completed",
                },
                {
                  type: "context.status_changed",
                  at: nowIso(),
                  contextId: String(currentContext.id),
                  status: "closed",
                },
              ],
            })
            if (!silent) {
              await closeContextStream({ preventClose, sendFinish, writable })
            }
            return {
              context: updatedContext,
              trigger,
              reaction: reactionEvent,
              execution,
            }
          }
        }

        // Execute actions (workflow context; action implementations decide step vs workflow)
        const actionResults = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.actionExecutionMs`,
          async () =>
            await Promise.all(
              actionRequests.map(async (actionRequest: any) => {
                const toolDef = (toolsAll as any)[actionRequest.actionName] as any
                if (!toolDef || typeof toolDef.execute !== "function") {
                  return {
                actionRequest,
                success: false,
                output: null,
                errorText: `Action "${actionRequest.actionName}" not found or has no execute().`,
              }
            }
            try {
              let actionInput = actionRequest.input
              if ((toolDef as any)?.auto === false) {
                const { createHook, createWebhook } = await import("workflow")
                const toolCallId = String(actionRequest.actionRef)
                const hookToken = toolApprovalHookToken({ executionId, toolCallId })
                const hook = createHook<ContextToolApprovalPayload>({ token: hookToken })
                const webhook = createWebhook()

                const approvalOrRequest = await Promise.race([
                  hook.then((approval) => ({ source: "hook" as const, approval })),
                  webhook.then((request) => ({ source: "webhook" as const, request })),
                ])

                const approval: ContextToolApprovalPayload | null =
                  approvalOrRequest.source === "hook"
                    ? approvalOrRequest.approval
                    : await (approvalOrRequest.request as any).json().catch(() => null)

                if (!approval || approval.approved !== true) {
                  return {
                    actionRequest,
                    success: false,
                    output: null,
                    errorText:
                      approval && "comment" in approval && approval.comment
                        ? `Action execution not approved: ${approval.comment}`
                        : "Action execution not approved",
                  }
                }
                if ("args" in approval && approval.args !== undefined) {
                  actionInput = approval.args
                }
              }

              const executeAction = toolDef.execute as Function
              const output = await Reflect.apply(executeAction, undefined, [actionInput, {
                runtime: runtimeHandle,
                context: updatedContext,
                contextIdentifier: activeContextSelector,
                toolCallId: actionRequest.actionRef,
                messages: messagesForModel,
                eventId: reactionEventId,
                executionId,
                triggerEventId,
                contextId: currentContext.id,
                stepId: String(openedStep.stepId),
                iteration: iter,
                contextStepStream: currentStepStream?.stream,
              }])
              return { actionRequest, success: true, output }
            } catch (e: any) {
              return {
                actionRequest,
                success: false,
                output: null,
                errorText: e instanceof Error ? e.message : String(e),
              }
            }
              }),
            ),
        )

        await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.writeActionResultPartChunksMs`,
          async () =>
            await writeActionResultPartChunks({
              session: currentStepStream,
              writable,
              silent,
              contextId: String(currentContext.id),
              executionId,
              itemId: reactionEventId,
              actionResults: actionResults as any,
            }),
        )

        // Merge action results into persisted parts (so next LLM call can see them)
        let finalizedStepParts = Array.isArray(stepParts) ? [...stepParts] : []
        for (const r of actionResults as any[]) {
          finalizedStepParts = applyToolExecutionResultToParts(
            finalizedStepParts,
            {
              toolCallId: r.actionRequest.actionRef,
              toolName: r.actionRequest.actionName,
            },
            {
              success: Boolean(r.success),
              result: r.output,
              message: r.errorText,
            },
          )
        }

        await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.saveFinalStepPartsMs`,
          async () =>
            await ops.saveContextPartsStep({
              stepId: openedStep.stepId,
              parts: finalizedStepParts,
              executionId,
              contextId: String(currentContext.id),
              iteration: iter,
            }),
        )

        reactionEvent = {
          ...reactionEvent,
          content: {
            ...reactionEvent.content,
            // Deprecated mirror for compatibility. `event_parts` are the
            // source of truth for replay and step inspection.
            parts: [...reactionPartsBeforeStep, ...finalizedStepParts],
          },
          status: "pending",
        }

        // Callback for observability/integration
        for (const r of actionResults as any[]) {
          await story.opts.onActionExecuted?.({
            actionRequest: r.actionRequest,
            success: r.success,
            output: r.output,
            errorText: r.errorText,
            eventId: reactionEventId,
            executionId,
          })
        }

        // Stop/continue boundary: allow the Context to decide if the loop should continue.
        // IMPORTANT: we call this after tool results have been merged into the persisted `reactionEvent`,
        // so stories can inspect `reactionEvent.content.parts` deterministically.
        const continueLoop = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.shouldContinueMs`,
          async () =>
            await story.shouldContinue({
              env,
              runtime: runtimeHandle,
              context: updatedContext,
              reactionEvent,
              assistantEvent: assistantEventEffective,
              actionRequests,
              actionResults: actionResults as any,
            }),
        )

        const firstActionResult = (actionResults as any[])?.[0]
        const finalizedReactionStatus = continueLoop === false ? "completed" : "pending"
        const finalizedReactionEvent: ContextItem = {
          ...reactionEvent,
          status: finalizedReactionStatus,
        }
        const finalizedStep = await measureBenchmark(
          params.__benchmark,
          `${stagePrefix}.finalizeReactionStepMs`,
          async () =>
            await ops.finalizeReactionStep({
              session: currentStepStream,
              stepId: openedStep.stepId,
              patch: {
                status: "completed",
                kind: (actionRequests as any[])?.length ? "action_result" : "message",
                actionName:
                  typeof firstActionResult?.actionRequest?.actionName === "string"
                    ? firstActionResult.actionRequest.actionName
                    : undefined,
                actionInput: firstActionResult?.actionRequest?.input,
                actionOutput:
                  firstActionResult?.success === true
                    ? firstActionResult?.output
                    : undefined,
                actionError:
                  firstActionResult?.success === false
                    ? String(firstActionResult?.errorText ?? "action_execution_failed")
                    : undefined,
                actionRequests,
                actionResults,
                continueLoop: continueLoop !== false,
              },
              reactionEventId,
              reactionEvent: finalizedReactionEvent,
              executionId,
              contextId: String(currentContext.id),
              iteration: iter,
            }),
        )
        currentStepStream = null
        reactionEvent = finalizedStep.reactionEvent ?? finalizedReactionEvent

        await emitContextEvents({
          silent,
          writable,
          events: [
            {
              type: "step.updated",
              at: nowIso(),
              stepId: String(openedStep.stepId),
              executionId,
              iteration: iter,
              status: "completed",
              kind: (actionRequests as any[])?.length ? "action_result" : "message",
              actionName:
                typeof firstActionResult?.actionRequest?.actionName === "string"
                  ? firstActionResult.actionRequest.actionName
                  : undefined,
            },
            {
              type: "step.completed",
              at: nowIso(),
              stepId: String(openedStep.stepId),
              executionId,
              iteration: iter,
              status: "completed",
            },
          ],
        })

        if (continueLoop !== false) {
          await emitContextEvents({
            silent,
            writable,
            events: [
              {
                type: "item.updated",
                at: nowIso(),
                itemId: String(reactionEventId),
                contextId: String(currentContext.id),
                executionId,
                status: "pending",
              },
            ],
          })
        }

        if (continueLoop === false) {
          await emitContextEvents({
            silent,
            writable,
            events: [
              {
                type: "item.completed",
                at: nowIso(),
                itemId: String(reactionEventId),
                contextId: String(currentContext.id),
                executionId,
                status: "completed",
              },
            ],
          })
          await measureBenchmark(
            params.__benchmark,
            `${stagePrefix}.completeExecutionMs`,
            async () => await ops.completeExecution(activeContextSelector, executionId, "completed"),
          )
          execution = { ...execution, status: "completed" }
          updatedContext = { ...updatedContext, status: "closed" }
          await emitContextEvents({
            silent,
            writable,
            events: [
              {
                type: "execution.completed",
                at: nowIso(),
                executionId,
                contextId: String(currentContext.id),
                status: "completed",
              },
              {
                type: "context.status_changed",
                at: nowIso(),
                contextId: String(currentContext.id),
                status: "closed",
              },
            ],
          })
          if (!silent) {
            await closeContextStream({ preventClose, sendFinish, writable })
          }
          return {
            context: updatedContext,
            trigger,
            reaction: reactionEvent,
            execution,
          }
        }
      }

      throw new Error(`ContextEngine: maxIterations reached (${maxIterations}) without completion`)
    } catch (error) {
      if (currentStepStream) {
        try {
          await abortPersistedContextStepStream({
            runtime: runtimeHandle as Runtime,
            session: currentStepStream,
            reason: error instanceof Error ? error.message : String(error),
          })
        } catch {
          // noop
        } finally {
          currentStepStream = null
        }
      }
      // Best-effort: persist failure on the current iteration step (if any)
      if (currentStepId) {
        const failedStepId = currentStepId
        try {
          await measureBenchmark(
            params.__benchmark,
            "react.failureStepPersistMs",
            async () =>
              await ops.updateContextStep({
                stepId: failedStepId,
                patch: {
                  status: "failed",
                  errorText: error instanceof Error ? error.message : String(error),
                },
                executionId,
                contextId: String(currentContext.id),
              }),
          )
          await emitContextEvents({
            silent,
            writable,
            events: [
              {
                type: "step.failed",
                at: nowIso(),
                stepId: String(failedStepId),
                executionId,
                status: "failed",
                errorText: error instanceof Error ? error.message : String(error),
              },
            ],
          })
        } catch {
          // noop
        }
      }
      await failExecution()
      throw error
    }
  }
  /**
   * @deprecated Use `react()` instead. Kept for backwards compatibility.
   */
  public async stream<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ) {
    return await this.react(triggerEvent, params as any)
  }

  private async callOnEnd(lastEvent: ContextItem): Promise<boolean> {
    if (!this.opts.onEnd) return true
    const result = await this.opts.onEnd(lastEvent)
    if (typeof result === "boolean") return result
    return true
  }
}



