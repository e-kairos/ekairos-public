import type { ModelMessage, Tool, UIMessageChunk } from "ai"
import { getWritable } from "workflow"

import type { ThreadEnvironment } from "./thread.config.js"
import { registerThreadEnv } from "./env.js"
import type { ThreadItem, ContextIdentifier, StoredContext } from "./thread.store.js"
import { applyToolExecutionResultToParts } from "./thread.toolcalls.js"
import type { ThreadStreamEvent } from "./thread.stream.js"

import type { SerializableToolForModel } from "./tools-to-model-tools.js"
import { toolsToModelTools } from "./tools-to-model-tools.js"
import {
  createAiSdkReactor,
  type ThreadReactor,
} from "./thread.reactor.js"
import {
  closeThreadStream,
  writeThreadEvents,
} from "./steps/stream.steps.js"
import {
  completeExecution,
  createThreadStep,
  initializeContext,
  saveReactionItem,
  saveTriggerAndCreateExecution,
  saveThreadPartsStep,
  updateThreadStep,
  updateContextContent,
  updateItem,
} from "./steps/store.steps.js"
import {
  getClientResumeHookUrl,
  toolApprovalHookToken,
  toolApprovalWebhookToken,
} from "./thread.hooks.js"

function createNoopWritable<T>(): WritableStream<T> {
  const writer: WritableStreamDefaultWriter<T> = {
    closed: Promise.resolve(undefined),
    desiredSize: 1,
    ready: Promise.resolve(undefined),
    abort: async () => undefined,
    close: async () => undefined,
    write: async () => undefined,
    releaseLock: () => undefined,
  } as WritableStreamDefaultWriter<T>

  return {
    locked: false,
    abort: async () => undefined,
    close: async () => undefined,
    getWriter: () => writer,
  } as WritableStream<T>
}


export interface ThreadOptions<Context = any, Env extends ThreadEnvironment = ThreadEnvironment> {
  onContextCreated?: (args: { env: Env; context: StoredContext<Context> }) => void | Promise<void>
  onContextUpdated?: (args: { env: Env; context: StoredContext<Context> }) => void | Promise<void>
  onEventCreated?: (event: ThreadItem) => void | Promise<void>
  onActionExecuted?: (executionEvent: any) => void | Promise<void>
  onEnd?: (
    lastEvent: ThreadItem,
  ) => void | boolean | Promise<void | boolean>
}

export interface ThreadStreamOptions {
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
   * Optional workflow writable stream to emit UIMessageChunks into.
   *
   * When omitted, the story will obtain a namespaced writable automatically:
   * `getWritable({ namespace: "context:<contextId>" })`.
   *
   * This allows multiple stories / contexts to stream concurrently within the same workflow run.
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
export type ThreadModelInit = string | (() => Promise<any>)

export type ThreadReactParams<Env extends ThreadEnvironment = ThreadEnvironment> = {
  env: Env
  /**
   * Context/thread selector (exclusive: `{ id }` OR `{ key }`).
   * - `{ id }` resolves a concrete context id.
   * - `{ key }` resolves by `thread.key`.
   * If omitted/null, the story will create a new thread+context pair.
   */
  context?: ContextIdentifier | null
  options?: ThreadStreamOptions
}

/**
 * Payload expected to resume an auto=false tool execution.
 *
 * This must be serializable because it crosses the workflow hook boundary.
 *
 * See: https://useworkflow.dev/docs/foundations/hooks
 */
export type ThreadToolApprovalPayload =
  | { approved: true; comment?: string; args?: Record<string, unknown> }
  | { approved: false; comment?: string }

export { toolApprovalHookToken, toolApprovalWebhookToken, getClientResumeHookUrl }

/**
 * Thread-level tool type.
 *
 * Allows threads to attach metadata to actions/tools (e.g. `{ auto: false }`)
 * while remaining compatible with the AI SDK `Tool` runtime shape.
 *
 * Default behavior when omitted: `auto === true`.
 */
export type ThreadTool = Tool & {
  /**
   * If `false`, this action is not intended for automatic execution by the engine.
   * (Validation/enforcement can be added by callers; default is `true`.)
   */
  auto?: boolean
}

/**
 * ## Thread loop continuation signal
 *
 * This hook result is intentionally a **boolean** so stories can be extremely declarative:
 *
 * - `return true`  => **continue** the durable loop
 * - `return false` => **finalize** the durable loop
 *
 * (No imports required in callers.)
 */
export type ShouldContinue = boolean

export type ThreadShouldContinueArgs<
  Context = any,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  env: Env
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
  reactionEvent: ThreadItem
  assistantEvent: ThreadItem
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

function contextThreadIdOrNull(context: StoredContext<any>): string | null {
  return typeof context.threadId === "string" && context.threadId.length > 0
    ? context.threadId
    : null
}

async function emitThreadEvents(params: {
  silent: boolean
  writable: WritableStream<UIMessageChunk>
  events: ThreadStreamEvent[]
}) {
  if (params.silent || params.events.length === 0) return
  await writeThreadEvents({ events: params.events, writable: params.writable })
}

export abstract class Thread<Context, Env extends ThreadEnvironment = ThreadEnvironment> {
  private readonly reactor: ThreadReactor<Context, Env>

  constructor(
    private opts: ThreadOptions<Context, Env> = {},
    reactor?: ThreadReactor<Context, Env>,
  ) {
    this.reactor = reactor ?? createAiSdkReactor<Context, Env>()
  }

  protected abstract initialize(
    context: StoredContext<Context>,
    env: Env,
  ): Promise<Context> | Context

  protected abstract buildSystemPrompt(
    context: StoredContext<Context>,
    env: Env,
  ): Promise<string> | string

  protected abstract buildTools(
    context: StoredContext<Context>,
    env: Env,
  ): Promise<Record<string, ThreadTool>> | Record<string, ThreadTool>

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
    events: ThreadItem[],
    _context: StoredContext<Context>,
    _env: Env,
  ): Promise<ThreadItem[]> {
    return events
  }

  protected getModel(_context: StoredContext<Context>, _env: Env): ThreadModelInit {
    return "openai/gpt-5"
  }

  protected getReactor(
    _context: StoredContext<Context>,
    _env: Env,
  ): ThreadReactor<Context, Env> {
    return this.reactor
  }

  /**
   * Thread stop/continue hook.
   *
   * After the model streamed and tools executed, the story can decide whether the loop should
   * continue.
   *
   * Default: `true` (continue).
   */
  protected async shouldContinue(
    _args: ThreadShouldContinueArgs<Context, Env>,
  ): Promise<ShouldContinue> {
    return true
  }

  /**
   * Workflow-first execution entrypoint.
   *
   * - Streaming is written to the workflow run's output stream.
   * - All I/O is delegated to steps (store access, LLM streaming, stream writes).
   * - This method returns metadata only.
   */
  /**
   * React to an incoming event and advance the story.
   *
   * This is the primary workflow entrypoint.
   */
  public async react(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ): Promise<{
    contextId: string
    context: StoredContext<Context>
    triggerEventId: string
    reactionEventId: string
    executionId: string
  }>
  /**
   * @deprecated Back-compat: old object-style call signature.
   */
  public async react(params: {
    env: Env
    /** @deprecated Use `triggerEvent` */
    incomingEvent?: ThreadItem
    triggerEvent?: ThreadItem
    contextIdentifier: ContextIdentifier | null
    options?: ThreadStreamOptions
  }): Promise<{
    contextId: string
    context: StoredContext<Context>
    triggerEventId: string
    reactionEventId: string
    executionId: string
  }>
  public async react(
    incomingEventOrParams:
      | ThreadItem
      | {
          env: Env
          incomingEvent?: ThreadItem
          triggerEvent?: ThreadItem
          contextIdentifier: ContextIdentifier | null
          options?: ThreadStreamOptions
        },
    paramsMaybe?: {
      env: Env
      context?: ContextIdentifier | null
      options?: ThreadStreamOptions
    },
  ) {
    return await Thread.runLoop(this, incomingEventOrParams as any, paramsMaybe as any)
  }

  private static async runLoop<Context, Env extends ThreadEnvironment>(
    story: Thread<Context, Env>,
    incomingEventOrParams:
      | ThreadItem
      | {
          env: Env
          incomingEvent?: ThreadItem
          triggerEvent?: ThreadItem
          contextIdentifier: ContextIdentifier | null
          options?: ThreadStreamOptions
        },
    paramsMaybe?: {
      env: Env
      context?: ContextIdentifier | null
      options?: ThreadStreamOptions
    },
  ) {
    const params =
      typeof (incomingEventOrParams as any)?.type === "string" && paramsMaybe
        ? {
            env: paramsMaybe.env,
            triggerEvent: incomingEventOrParams as ThreadItem,
            contextIdentifier: paramsMaybe.context ?? null,
            options: paramsMaybe.options,
          }
        : (incomingEventOrParams as {
            env: Env
            incomingEvent?: ThreadItem
            triggerEvent?: ThreadItem
            contextIdentifier: ContextIdentifier | null
            options?: ThreadStreamOptions
          })

    const triggerEvent =
      (params as any).triggerEvent ?? (params as any).incomingEvent
    if (!triggerEvent) {
      throw new Error("Thread.react: triggerEvent is required")
    }

    // Register env for step runtimes (workflow-friendly).
    try {
      const { getWorkflowMetadata } = await import("workflow")
      const meta = getWorkflowMetadata?.()
      const runId = meta?.workflowRunId ? String(meta.workflowRunId) : null
      registerThreadEnv(params.env as any, runId ?? undefined)
    } catch {
      registerThreadEnv(params.env as any)
    }

    const maxIterations = params.options?.maxIterations ?? 20
    const maxModelSteps = params.options?.maxModelSteps ?? 1
    const preventClose = params.options?.preventClose ?? false
    const sendFinish = params.options?.sendFinish ?? true
    const silent = params.options?.silent ?? false
    let writable = params.options?.writable
    // 1) Ensure context exists (step)
    const ctxResult = await initializeContext<Context>(
      params.env,
      params.contextIdentifier,
      { silent, writable },
    )
    const currentContext = ctxResult.context

    // If the caller didn't provide a writable, we still stream by default (unless silent),
    // using a namespaced stream per context: `context:<contextId>`.
    if (!silent && !writable) {
      writable = getWritable<UIMessageChunk>({
        namespace: `context:${String(currentContext.id)}`,
      })
    }

    // Reactor/steps always receive a stream argument.
    // In silent mode (or when no workflow writable is available), we use an in-memory sink.
    if (!writable) {
      writable = createNoopWritable<UIMessageChunk>()
    }

    const contextSelector: ContextIdentifier =
      params.contextIdentifier?.id
        ? { id: String(params.contextIdentifier.id) }
        : params.contextIdentifier?.key
          ? { key: params.contextIdentifier.key }
          : { id: String(currentContext.id) }
    const threadId = contextThreadIdOrNull(currentContext)
    const resolvedThreadId = threadId ?? String(currentContext.id)
    await emitThreadEvents({
      silent,
      writable,
      events: [
        {
          type: ctxResult.isNew ? "context.created" : "context.resolved",
          at: nowIso(),
          contextId: String(currentContext.id),
          threadId: resolvedThreadId,
          status: String(currentContext.status ?? "open") as any,
        },
        {
          type: ctxResult.isNew ? "thread.created" : "thread.resolved",
          at: nowIso(),
          threadId: resolvedThreadId,
          status: "idle",
        },
      ],
    })

    if (ctxResult.isNew) {
      await story.opts.onContextCreated?.({ env: params.env, context: currentContext })
    }

    // 2) Persist trigger event + create execution shell (single step)
    const { triggerEventId, reactionEventId, executionId } =
      await saveTriggerAndCreateExecution({
      env: params.env,
      contextIdentifier: contextSelector,
      triggerEvent,
    })

    await emitThreadEvents({
      silent,
      writable,
      events: [
        {
          type: "item.created",
          at: nowIso(),
          itemId: triggerEventId,
          contextId: String(currentContext.id),
          threadId: resolvedThreadId,
          status: "stored",
          itemType: "input",
          executionId,
        },
        {
          type: "thread.streaming_started",
          at: nowIso(),
          threadId: resolvedThreadId,
          status: "streaming",
        },
        {
          type: "execution.created",
          at: nowIso(),
          executionId,
          contextId: String(currentContext.id),
          threadId: resolvedThreadId,
          status: "executing",
        },
      ],
    })

    let reactionEvent: ThreadItem | null = null
    // Latest persisted context state for this run (we keep it in memory; store is updated via steps).
    let updatedContext: StoredContext<Context> = currentContext
    let currentStepId: string | null = null

    const failExecution = async () => {
      try {
        await completeExecution(params.env, contextSelector, executionId, "failed")
        await emitThreadEvents({
          silent,
          writable,
          events: [
            {
              type: "execution.failed",
              at: nowIso(),
              executionId,
              contextId: String(currentContext.id),
              threadId: resolvedThreadId,
              status: "failed",
            },
            {
              type: "context.closed",
              at: nowIso(),
              contextId: String(currentContext.id),
              threadId: resolvedThreadId,
              status: "closed",
            },
            {
              type: "thread.idle",
              at: nowIso(),
              threadId: resolvedThreadId,
              status: "idle",
            },
          ],
        })
      } catch {
        // noop
      }
      try {
        if (!silent) {
          await closeThreadStream({ preventClose, sendFinish, writable })
        }
      } catch {
        // noop
      }
    }

    try {
      for (let iter = 0; iter < maxIterations; iter++) {
        // Create a persisted step per iteration (IDs generated in step runtime for replay safety)
        const stepCreate = await createThreadStep({
          env: params.env,
          executionId,
          iteration: iter,
        })
        currentStepId = stepCreate.stepId
        await emitThreadEvents({
          silent,
          writable,
          events: [
            {
              type: "step.created",
              at: nowIso(),
              stepId: String(stepCreate.stepId),
              executionId,
              iteration: iter,
              status: "running",
            },
          ],
        })

    // Hook: Thread DSL `context()` (implemented by subclasses via `initialize()`)
        const nextContent = await story.initialize(updatedContext, params.env)
        updatedContext = await updateContextContent<Context>(
          params.env,
          contextSelector,
          nextContent,
        )
        await emitThreadEvents({
          silent,
          writable,
          events: [
            {
              type: "context.content_updated",
              at: nowIso(),
              contextId: String(updatedContext.id),
              threadId: String(contextThreadIdOrNull(updatedContext) ?? ""),
            },
          ],
        })

        await story.opts.onContextUpdated?.({ env: params.env, context: updatedContext })

        // Hook: Thread DSL `narrative()` (implemented by subclasses via `buildSystemPrompt()`)
        const systemPrompt = await story.buildSystemPrompt(updatedContext, params.env)

        // Hook: Thread DSL `actions()` (implemented by subclasses via `buildTools()`)
        const toolsAll = await story.buildTools(updatedContext, params.env)

        // IMPORTANT: step args must be serializable.
        // Match DurableAgent behavior: convert tool input schemas to plain JSON Schema in workflow context.
        const toolsForModel: Record<string, SerializableToolForModel> = toolsToModelTools(
          toolsAll as any,
        )
        // Execute model reaction for this iteration using the stable reaction event id.
        //
        // IMPORTANT:
        // We expose a single visible `context_event` per story turn (`reactionEventId`).
        // If we stream with a per-step id, the UI will render an optimistic assistant message
        // (step id) and then a second persisted assistant message (reaction id) with the same
        // content once InstantDB updates.
        const reactor = story.getReactor(updatedContext, params.env)
        const { assistantEvent, actionRequests, messagesForModel } = await reactor({
          env: params.env,
          context: updatedContext,
          contextIdentifier: contextSelector,
          triggerEvent,
          model: story.getModel(updatedContext, params.env),
          systemPrompt,
          actions: toolsAll as Record<string, unknown>,
          toolsForModel,
          eventId: reactionEventId,
          executionId,
          contextId: String(currentContext.id),
          stepId: String(stepCreate.stepId),
          iteration: iter,
          maxModelSteps,
          // Only emit a `start` chunk once per story turn.
          sendStart: !silent && iter === 0 && reactionEvent === null,
          silent,
          writable,
        })

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

        // Persist normalized parts hanging off the producing step (thread_parts).
        // IMPORTANT:
        // We intentionally do NOT persist the per-step LLM assistant event as a `context_event`.
        // The story exposes a single visible `context_event` per turn (`reactionEventId`) so the UI
        // doesn't render duplicate assistant messages (LLM-step + aggregated reaction).
        const stepParts = (((assistantEvent as any)?.content?.parts ?? []) as any[]) as any[]
        const assistantEventEffective: ThreadItem = {
          ...assistantEvent,
          content: {
            ...((assistantEvent as any)?.content ?? {}),
            parts: stepParts,
          },
        }
        await saveThreadPartsStep({
          env: params.env,
          stepId: stepCreate.stepId,
          parts: stepParts,
          executionId,
          contextId: String(currentContext.id),
          iteration: iter,
        })
        await emitThreadEvents({
          silent,
          writable,
          events: stepParts.map((part: any, idx: number) => ({
            type: "part.created" as const,
            at: nowIso(),
            partKey: `${String(stepCreate.stepId)}:${idx}`,
            stepId: String(stepCreate.stepId),
            idx,
            partType:
              part && typeof part.type === "string"
                ? String(part.type)
                : undefined,
            ...summarizePartPreview(part),
          })),
        })

        // Persist/append the aggregated reaction event (stable `reactionEventId` for the execution).
        if (!reactionEvent) {
          const reactionPayload: ThreadItem = {
            ...assistantEventEffective,
            status: "pending",
          }
          reactionEvent = await saveReactionItem(
            params.env,
            contextSelector,
            reactionPayload,
            {
              executionId,
              contextId: String(currentContext.id),
              reviewRequests,
            },
          )
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "item.created",
                at: nowIso(),
                itemId: String(reactionEvent.id),
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                executionId,
                status: "pending",
                itemType: "output",
              },
            ],
          })
        } else {
          const existingReactionParts = Array.isArray(reactionEvent.content?.parts)
            ? reactionEvent.content.parts
            : []
          const nextAssistantParts = Array.isArray(assistantEventEffective.content?.parts)
            ? assistantEventEffective.content.parts
            : []
          const nextReactionEvent: ThreadItem = {
            ...reactionEvent,
            content: {
              ...reactionEvent.content,
              parts: [...existingReactionParts, ...nextAssistantParts],
            },
            status: "pending",
          }
          reactionEvent = await updateItem(
            params.env,
            reactionEvent.id,
            nextReactionEvent,
            { executionId, contextId: String(currentContext.id) },
          )
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "item.updated",
                at: nowIso(),
                itemId: String(reactionEvent.id),
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                executionId,
                status: "pending",
              },
            ],
          })
        }

        story.opts.onEventCreated?.(assistantEventEffective)

        const firstActionRequest = (actionRequests as any[])?.[0] as
          | { actionName?: string; actionRef?: string; input?: unknown }
          | undefined
        await updateThreadStep({
          env: params.env,
          stepId: stepCreate.stepId,
          patch: firstActionRequest
            ? {
                kind: "action_execute",
                actionName:
                  typeof firstActionRequest.actionName === "string"
                    ? firstActionRequest.actionName
                    : undefined,
                actionInput: firstActionRequest.input,
              }
            : {
                kind: "message",
              },
          executionId,
          contextId: String(currentContext.id),
          iteration: iter,
        })
        await emitThreadEvents({
          silent,
          writable,
          events: [
            {
              type: "step.updated",
              at: nowIso(),
              stepId: String(stepCreate.stepId),
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
            // Mark iteration step completed (no tools)
          await updateThreadStep({
            env: params.env,
            stepId: stepCreate.stepId,
            patch: {
              status: "completed",
              kind: "message",
              actionRequests: [],
              actionResults: [],
              continueLoop: false,
            },
            executionId,
            contextId: String(currentContext.id),
            iteration: iter,
          })
            await emitThreadEvents({
              silent,
              writable,
              events: [
                {
                  type: "step.updated",
                  at: nowIso(),
                  stepId: String(stepCreate.stepId),
                  executionId,
                  iteration: iter,
                  status: "completed",
                  kind: "message",
                },
                {
                  type: "step.completed",
                  at: nowIso(),
                  stepId: String(stepCreate.stepId),
                  executionId,
                  iteration: iter,
                  status: "completed",
                },
              ],
            })

            // Mark reaction event completed
            await updateItem(
              params.env,
              reactionEventId,
              {
                ...(reactionEvent ?? assistantEventEffective),
                status: "completed",
              },
              { executionId, contextId: String(currentContext.id) },
            )
            await emitThreadEvents({
              silent,
              writable,
              events: [
                {
                  type: "item.completed",
                  at: nowIso(),
                  itemId: String(reactionEventId),
                  contextId: String(currentContext.id),
                  threadId: resolvedThreadId,
                  executionId,
                  status: "completed",
                },
              ],
            })
            await completeExecution(params.env, contextSelector, executionId, "completed")
            await emitThreadEvents({
              silent,
              writable,
              events: [
                {
                  type: "execution.completed",
                  at: nowIso(),
                  executionId,
                  contextId: String(currentContext.id),
                  threadId: resolvedThreadId,
                  status: "completed",
                },
                {
                  type: "context.closed",
                  at: nowIso(),
                  contextId: String(currentContext.id),
                  threadId: resolvedThreadId,
                  status: "closed",
                },
                {
                  type: "thread.idle",
                  at: nowIso(),
                  threadId: resolvedThreadId,
                  status: "idle",
                },
              ],
            })
            if (!silent) {
              await closeThreadStream({ preventClose, sendFinish, writable })
            }
            return {
              contextId: currentContext.id,
              context: updatedContext,
              triggerEventId,
              reactionEventId,
              executionId,
            }
          }
        }

        // Execute actions (workflow context; action implementations decide step vs workflow)
        const actionResults = await Promise.all(
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
                const webhookToken = toolApprovalWebhookToken({ executionId, toolCallId })

                const hook = createHook<ThreadToolApprovalPayload>({ token: hookToken })
                const webhook = createWebhook({ token: webhookToken })

                const approvalOrRequest = await Promise.race([
                  hook.then((approval) => ({ source: "hook" as const, approval })),
                  webhook.then((request) => ({ source: "webhook" as const, request })),
                ])

                const approval: ThreadToolApprovalPayload | null =
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

              const output = await toolDef.execute(actionInput, {
                toolCallId: actionRequest.actionRef,
                messages: messagesForModel,
                eventId: reactionEventId,
                executionId,
                triggerEventId,
                contextId: currentContext.id,
              })
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
        )

        // Merge action results into persisted parts (so next LLM call can see them)
        if (reactionEvent) {
          let parts = Array.isArray(reactionEvent.content?.parts)
            ? [...reactionEvent.content.parts]
            : []
          for (const r of actionResults as any[]) {
            parts = applyToolExecutionResultToParts(
              parts,
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

          reactionEvent = {
            ...reactionEvent,
            content: {
              ...reactionEvent.content,
              parts,
            },
            status: "pending",
          }
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

        // Stop/continue boundary: allow the Thread to decide if the loop should continue.
        // IMPORTANT: we call this after tool results have been merged into the persisted `reactionEvent`,
        // so stories can inspect `reactionEvent.content.parts` deterministically.
        const continueLoop = await story.shouldContinue({
          env: params.env,
          context: updatedContext,
          reactionEvent: reactionEvent ?? assistantEventEffective,
          assistantEvent: assistantEventEffective,
          actionRequests,
          actionResults: actionResults as any,
        })

        // Persist per-iteration step outcome (tools + continue signal)
        await updateThreadStep({
          env: params.env,
          stepId: stepCreate.stepId,
          patch: {
            status: "completed",
            kind: (actionRequests as any[])?.length ? "action_result" : "message",
            actionName:
              typeof (actionResults as any[])?.[0]?.actionRequest?.actionName === "string"
                ? (actionResults as any[])[0].actionRequest.actionName
                : undefined,
            actionInput: (actionResults as any[])?.[0]?.actionRequest?.input,
            actionOutput:
              (actionResults as any[])?.[0]?.success === true
                ? (actionResults as any[])[0]?.output
                : undefined,
            actionError:
              (actionResults as any[])?.[0]?.success === false
                ? String((actionResults as any[])[0]?.errorText ?? "action_execution_failed")
                : undefined,
            actionRequests,
            actionResults,
            continueLoop: continueLoop !== false,
          },
          executionId,
          contextId: String(currentContext.id),
          iteration: iter,
        })
        await emitThreadEvents({
          silent,
          writable,
          events: [
            {
              type: "step.updated",
              at: nowIso(),
              stepId: String(stepCreate.stepId),
              executionId,
              iteration: iter,
              status: "completed",
              kind: (actionRequests as any[])?.length ? "action_result" : "message",
              actionName:
                typeof (actionResults as any[])?.[0]?.actionRequest?.actionName === "string"
                  ? (actionResults as any[])[0].actionRequest.actionName
                  : undefined,
            },
            {
              type: "step.completed",
              at: nowIso(),
              stepId: String(stepCreate.stepId),
              executionId,
              iteration: iter,
              status: "completed",
            },
          ],
        })

        if (continueLoop !== false && reactionEvent) {
          reactionEvent = await updateItem(
            params.env,
            reactionEventId,
            {
              ...reactionEvent,
              status: "pending",
            },
            { executionId, contextId: String(currentContext.id) },
          )
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "item.updated",
                at: nowIso(),
                itemId: String(reactionEventId),
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                executionId,
                status: "pending",
              },
            ],
          })
        }

        if (continueLoop === false) {
          await updateItem(
            params.env,
            reactionEventId,
            {
              ...(reactionEvent ?? assistantEventEffective),
              status: "completed",
            },
            { executionId, contextId: String(currentContext.id) },
          )
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "item.completed",
                at: nowIso(),
                itemId: String(reactionEventId),
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                executionId,
                status: "completed",
              },
            ],
          })
          await completeExecution(params.env, contextSelector, executionId, "completed")
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "execution.completed",
                at: nowIso(),
                executionId,
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                status: "completed",
              },
              {
                type: "context.closed",
                at: nowIso(),
                contextId: String(currentContext.id),
                threadId: resolvedThreadId,
                status: "closed",
              },
              {
                type: "thread.idle",
                at: nowIso(),
                threadId: resolvedThreadId,
                status: "idle",
              },
            ],
          })
          if (!silent) {
            await closeThreadStream({ preventClose, sendFinish, writable })
          }
          return {
            contextId: currentContext.id,
            context: updatedContext,
            triggerEventId,
            reactionEventId,
            executionId,
          }
        }
      }

      throw new Error(`Thread: maxIterations reached (${maxIterations}) without completion`)
    } catch (error) {
      // Best-effort: persist failure on the current iteration step (if any)
      if (currentStepId) {
        try {
          await updateThreadStep({
            env: params.env,
            stepId: currentStepId,
            patch: {
              status: "failed",
              errorText: error instanceof Error ? error.message : String(error),
            },
            executionId,
            contextId: String(currentContext.id),
          })
          await emitThreadEvents({
            silent,
            writable,
            events: [
              {
                type: "step.failed",
                at: nowIso(),
                stepId: String(currentStepId),
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
  public async stream(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ) {
    return await this.react(triggerEvent, params)
  }

  private async callOnEnd(lastEvent: ThreadItem): Promise<boolean> {
    if (!this.opts.onEnd) return true
    const result = await this.opts.onEnd(lastEvent)
    if (typeof result === "boolean") return result
    return true
  }
}



