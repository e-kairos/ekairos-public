import type { ModelMessage, Tool, UIMessageChunk } from "ai"
import { getWritable } from "workflow"

import type { ThreadEnvironment } from "./thread.config.js"
import { registerThreadEnv } from "./env.js"
import type { ThreadItem, ContextIdentifier, StoredContext } from "./thread.store.js"
import { applyToolExecutionResultToParts } from "./thread.toolcalls.js"

import type { SerializableToolForModel } from "./tools-to-model-tools.js"
import { toolsToModelTools } from "./tools-to-model-tools.js"
import {
  createAiSdkReactor,
  type ThreadReactor,
} from "./thread.reactor.js"
import {
  closeThreadStream,
  writeContextSubstate,
  writeThreadPing,
  writeToolOutputs,
} from "./steps/stream.steps.js"
import {
  completeExecution,
  createThreadStep,
  emitContextIdChunk,
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


export interface ThreadOptions<Context = any, Env extends ThreadEnvironment = ThreadEnvironment> {
  onContextCreated?: (args: { env: Env; context: StoredContext<Context> }) => void | Promise<void>
  onContextUpdated?: (args: { env: Env; context: StoredContext<Context> }) => void | Promise<void>
  onEventCreated?: (event: ThreadItem) => void | Promise<void>
  onToolCallExecuted?: (executionEvent: any) => void | Promise<void>
  onEnd?: (
    lastEvent: ThreadItem,
  ) => void | { end?: boolean } | Promise<void | { end?: boolean }>
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
export type ThreadModelInit = string | (() => Promise<any>) | any

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
  toolCalls: any[]
  toolExecutionResults: Array<{
    tc: any
    success: boolean
    output: any
    errorText?: string
  }>
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

      // If the context was created in `initializeContext` (which didn't have a writable yet),
      // re-emit the context id chunk now so clients can subscribe to the right persisted thread.
      if (ctxResult.isNew) {
        await emitContextIdChunk({
          env: params.env,
          contextId: String(currentContext.id),
          writable,
        })
      }
    }

    const contextSelector: ContextIdentifier =
      params.contextIdentifier?.id
        ? { id: String(params.contextIdentifier.id) }
        : params.contextIdentifier?.key
          ? { key: params.contextIdentifier.key }
          : { id: String(currentContext.id) }

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

    // Emit a simple ping chunk early so clients can validate that streaming works end-to-end.
    // This should be ignored safely by clients that don't care about it.
    if (!silent) {
      await writeThreadPing({ label: "thread-start", writable })
    }

    let reactionEvent: ThreadItem | null = null
    // Latest persisted context state for this run (we keep it in memory; store is updated via steps).
    let updatedContext: StoredContext<Context> = currentContext
    let currentStepId: string | null = null

    const failExecution = async () => {
      try {
        await completeExecution(params.env, contextSelector, executionId, "failed")
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

    // Hook: Thread DSL `context()` (implemented by subclasses via `initialize()`)
        const nextContent = await story.initialize(updatedContext, params.env)
        updatedContext = await updateContextContent<Context>(
          params.env,
          contextSelector,
          nextContent,
        )

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
        const { assistantEvent, toolCalls, messagesForModel } = await reactor({
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
          toolCalls.length > 0
            ? (toolCalls as any[]).flatMap((tc) => {
                const toolDef = (toolsAll as any)[tc.toolName] as any
                const auto = toolDef?.auto !== false
                ;(tc as any).auto = auto
                if (auto) return []
                return [
                  {
                    toolCallId: String(tc.toolCallId),
                    toolName: String(tc.toolName ?? ""),
                  },
                ]
              })
            : []

        // Persist normalized parts hanging off the producing step (thread_parts).
        // IMPORTANT:
        // We intentionally do NOT persist the per-step LLM assistant event as a `context_event`.
        // The story exposes a single visible `context_event` per turn (`reactionEventId`) so the UI
        // doesn't render duplicate assistant messages (LLM-step + aggregated reaction).
        const stepParts = ((assistantEvent as any)?.content?.parts ?? []) as any[]
        await saveThreadPartsStep({
          env: params.env,
          stepId: stepCreate.stepId,
          parts: stepParts,
          executionId,
          contextId: String(currentContext.id),
          iteration: iter,
        })

        // Persist/append the aggregated reaction event (stable `reactionEventId` for the execution).
        if (!reactionEvent) {
          const reactionPayload = {
            ...(assistantEvent as any),
            status: "pending",
          }
          reactionEvent = await saveReactionItem(
            params.env,
            contextSelector,
            reactionPayload as any,
            {
              executionId,
              contextId: String(currentContext.id),
              reviewRequests,
            },
          )
        } else {
          reactionEvent = await updateItem(
            params.env,
            reactionEvent.id,
            {
              ...(reactionEvent as any),
              content: {
                parts: [
                  ...((reactionEvent as any)?.content?.parts ?? []),
                  ...((assistantEvent as any)?.content?.parts ?? []),
                ],
              },
              status: "pending",
            } as any,
            { executionId, contextId: String(currentContext.id) },
          )
        }

        story.opts.onEventCreated?.(assistantEvent)

        // Done: no tool calls requested by the model
        if (!toolCalls.length) {
          const endResult = await story.callOnEnd(assistantEvent)
          if (endResult) {
            // Mark iteration step completed (no tools)
          await updateThreadStep({
            env: params.env,
            stepId: stepCreate.stepId,
            patch: {
              status: "completed",
              toolCalls: [],
              toolExecutionResults: [],
              continueLoop: false,
            },
            executionId,
            contextId: String(currentContext.id),
            iteration: iter,
          })

            // Mark reaction event completed
            await updateItem(
              params.env,
              reactionEventId,
              {
                ...(reactionEvent as any),
                status: "completed",
              } as any,
              { executionId, contextId: String(currentContext.id) },
            )
            await completeExecution(params.env, contextSelector, executionId, "completed")
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

        // Execute tool calls (workflow context; tool implementations decide step vs workflow)
        if (!silent && toolCalls.length) {
          await writeContextSubstate({ key: "actions", transient: true, writable })
        }
        const executionResults = await Promise.all(
          toolCalls.map(async (tc: any) => {
            const toolDef = (toolsAll as any)[tc.toolName] as any
            if (!toolDef || typeof toolDef.execute !== "function") {
              return {
                tc,
                success: false,
                output: null,
                errorText: `Tool "${tc.toolName}" not found or has no execute().`,
              }
            }
            try {
              let toolArgs = tc.args
              if ((toolDef as any)?.auto === false) {
                const { createHook, createWebhook } = await import("workflow")
                const toolCallId = String(tc.toolCallId)
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
                    tc,
                    success: false,
                    output: null,
                    errorText:
                      approval && "comment" in approval && approval.comment
                        ? `Tool execution not approved: ${approval.comment}`
                        : "Tool execution not approved",
                  }
                }
                if ("args" in approval && approval.args !== undefined) {
                  toolArgs = approval.args
                }
              }

              const output = await toolDef.execute(toolArgs, {
                toolCallId: tc.toolCallId,
                messages: messagesForModel,
                eventId: reactionEventId,
                executionId,
                triggerEventId,
                contextId: currentContext.id,
              })
              return { tc, success: true, output }
            } catch (e: any) {
              return {
                tc,
                success: false,
                output: null,
                errorText: e instanceof Error ? e.message : String(e),
              }
            }
          }),
        )

        // Emit tool outputs to the workflow stream (step)
        if (!silent) {
          await writeToolOutputs({
            results: executionResults.map((r: any) =>
              r.success
                ? ({ toolCallId: r.tc.toolCallId, success: true, output: r.output } as const)
                : ({
                    toolCallId: r.tc.toolCallId,
                    success: false,
                    errorText: r.errorText,
                  } as const),
            ),
            writable,
          })
        }
        // Clear action status once tool execution results have been emitted.
        if (!silent && toolCalls.length) {
          await writeContextSubstate({ key: null, transient: true, writable })
        }

        // Merge tool results into persisted parts (so next LLM call can see them)
        if (reactionEvent) {
          let parts = (reactionEvent as any)?.content?.parts ?? []
          for (const r of executionResults as any[]) {
            parts = applyToolExecutionResultToParts(parts, r.tc, {
              success: Boolean(r.success),
              result: r.output,
              message: r.errorText,
            })
          }

          reactionEvent = await updateItem(
            params.env,
            reactionEventId,
            {
              ...(reactionEvent as any),
              content: { parts },
              status: "pending",
            } as any,
            { executionId, contextId: String(currentContext.id) },
          )
        }

        // Callback for observability/integration
        for (const r of executionResults as any[]) {
          await story.opts.onToolCallExecuted?.({
            toolCall: r.tc,
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
          reactionEvent: (reactionEvent as any) ?? (assistantEvent as any),
          assistantEvent,
          toolCalls,
          toolExecutionResults: executionResults as any,
        })

        // Persist per-iteration step outcome (tools + continue signal)
        await updateThreadStep({
          env: params.env,
          stepId: stepCreate.stepId,
          patch: {
            status: "completed",
            toolCalls,
            toolExecutionResults: executionResults,
            continueLoop: continueLoop !== false,
          },
          executionId,
          contextId: String(currentContext.id),
          iteration: iter,
        })

        if (continueLoop === false) {
          await updateItem(
            params.env,
            reactionEventId,
            {
              ...(reactionEvent as any),
              status: "completed",
            } as any,
            { executionId, contextId: String(currentContext.id) },
          )
          await completeExecution(params.env, contextSelector, executionId, "completed")
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
    if (result && typeof result === "object" && "end" in result) return Boolean((result as any).end)
    return true
  }
}



