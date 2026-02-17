import type { ModelMessage, UIMessageChunk } from "ai"

import type { ThreadEnvironment } from "./thread.config.js"
import type { ThreadModelInit } from "./thread.engine.js"
import type { ContextIdentifier, StoredContext, ThreadItem } from "./thread.store.js"
import type { SerializableToolForModel } from "./tools-to-model-tools.js"
import { executeReaction } from "./steps/reaction.steps.js"

export type ThreadReactionToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
}

export type ThreadReactionLLM = {
  provider?: string
  model?: string
  promptTokens?: number
  promptTokensCached?: number
  promptTokensUncached?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number
  rawUsage?: unknown
  rawProviderMetadata?: unknown
}

export type ThreadReactionResult = {
  assistantEvent: ThreadItem
  toolCalls: ThreadReactionToolCall[]
  messagesForModel: ModelMessage[]
  llm?: ThreadReactionLLM
}

export type ThreadReactorParams<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  env: Env
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  triggerEvent: ThreadItem
  model: ThreadModelInit
  systemPrompt: string
  actions: Record<string, unknown>
  toolsForModel: Record<string, SerializableToolForModel>
  eventId: string
  executionId: string
  contextId: string
  stepId: string
  iteration: number
  maxModelSteps: number
  sendStart: boolean
  silent: boolean
  writable?: WritableStream<UIMessageChunk>
}

export type ThreadReactor<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = (
  params: ThreadReactorParams<Context, Env>,
) => Promise<ThreadReactionResult>

export type CreateAiSdkReactorOptions<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
  Config = unknown,
> = {
  resolveConfig?: (params: {
    env: Env
    context: StoredContext<Context>
    contextIdentifier: ContextIdentifier
    triggerEvent: ThreadItem
    model: ThreadModelInit
    eventId: string
    executionId: string
    contextId: string
    stepId: string
    iteration: number
  }) => Promise<Config> | Config
  selectModel?: (params: {
    env: Env
    context: StoredContext<Context>
    triggerEvent: ThreadItem
    baseModel: ThreadModelInit
    config: Config
  }) => Promise<ThreadModelInit> | ThreadModelInit
  selectMaxModelSteps?: (params: {
    env: Env
    context: StoredContext<Context>
    triggerEvent: ThreadItem
    baseMaxModelSteps: number
    config: Config
  }) => Promise<number> | number
}

/**
 * Default reactor for Thread: Vercel AI SDK (`streamText`) with tool-call extraction.
 *
 * This keeps current behavior and can be replaced per-thread using `.reactor(...)`.
 */
export function createAiSdkReactor<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
  Config = unknown,
>(
  options?: CreateAiSdkReactorOptions<Context, Env, Config>,
): ThreadReactor<Context, Env> {
  return async (params) => {
    let config: Config | undefined
    if (options?.resolveConfig) {
      config = await options.resolveConfig({
        env: params.env,
        context: params.context,
        contextIdentifier: params.contextIdentifier,
        triggerEvent: params.triggerEvent,
        model: params.model,
        eventId: params.eventId,
        executionId: params.executionId,
        contextId: params.contextId,
        stepId: params.stepId,
        iteration: params.iteration,
      })
    }

    const model =
      options?.selectModel && config !== undefined
        ? await options.selectModel({
            env: params.env,
            context: params.context,
            triggerEvent: params.triggerEvent,
            baseModel: params.model,
            config,
          })
        : params.model

    const maxSteps =
      options?.selectMaxModelSteps && config !== undefined
        ? await options.selectMaxModelSteps({
            env: params.env,
            context: params.context,
            triggerEvent: params.triggerEvent,
            baseMaxModelSteps: params.maxModelSteps,
            config,
          })
        : params.maxModelSteps

    const result = await executeReaction({
      env: params.env,
      contextIdentifier: params.contextIdentifier,
      model,
      system: params.systemPrompt,
      tools: params.toolsForModel,
      eventId: params.eventId,
      iteration: params.iteration,
      maxSteps,
      sendStart: params.sendStart,
      silent: params.silent,
      writable: params.writable,
      executionId: params.executionId,
      contextId: params.contextId,
      stepId: params.stepId,
    })

    return {
      assistantEvent: result.assistantEvent,
      toolCalls: result.toolCalls as ThreadReactionToolCall[],
      messagesForModel: result.messagesForModel,
      llm: result.llm,
    }
  }
}
