import type { ContextEnvironment } from "../context.config.js"
import type { ContextRuntime } from "../context.runtime.js"
import type { ContextModelInit } from "../context.engine.js"
import type { ContextIdentifier, StoredContext, ContextItem } from "../context.store.js"
import { executeAiSdkReaction } from "./ai-sdk.step.js"
import type {
  ContextActionRequest,
  ContextReactor,
} from "./types.js"

export type CreateAiSdkReactorOptions<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
  Config = unknown,
> = {
  resolveConfig?: (params: {
    runtime: ContextRuntime<Env>
    env: Env
    context: StoredContext<Context>
    contextIdentifier: ContextIdentifier
    triggerEvent: ContextItem
    model: ContextModelInit
    eventId: string
    executionId: string
    contextId: string
    stepId: string
    iteration: number
  }) => Promise<Config> | Config
  selectModel?: (params: {
    runtime: ContextRuntime<Env>
    env: Env
    context: StoredContext<Context>
    triggerEvent: ContextItem
    baseModel: ContextModelInit
    config: Config
  }) => Promise<ContextModelInit> | ContextModelInit
  selectMaxModelSteps?: (params: {
    runtime: ContextRuntime<Env>
    env: Env
    context: StoredContext<Context>
    triggerEvent: ContextItem
    baseMaxModelSteps: number
    config: Config
  }) => Promise<number> | number
}

export function createAiSdkReactor<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
  Config = unknown,
>(
  options?: CreateAiSdkReactorOptions<Context, Env, Config>,
): ContextReactor<Context, Env> {
  return async (params) => {
    let config: Config | undefined
    if (options?.resolveConfig) {
      config = await options.resolveConfig({
        runtime: params.runtime,
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
            runtime: params.runtime,
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
            runtime: params.runtime,
            env: params.env,
            context: params.context,
            triggerEvent: params.triggerEvent,
            baseMaxModelSteps: params.maxModelSteps,
            config,
          })
        : params.maxModelSteps

    const result = await executeAiSdkReaction({
      runtime: params.runtime,
      env: params.env,
      contextIdentifier: params.contextIdentifier,
      model,
      system: params.systemPrompt,
      tools: params.actionSpecs,
      eventId: params.eventId,
      iteration: params.iteration,
      maxSteps,
      sendStart: params.sendStart,
      silent: params.silent,
      contextStepStream: params.contextStepStream,
      writable: params.writable,
      executionId: params.executionId,
      contextId: params.contextId,
      stepId: params.stepId,
    })

    return {
      assistantEvent: result.assistantEvent,
      actionRequests: (result.toolCalls as Array<{
        toolCallId: string
        toolName: string
        args: unknown
      }>).map((entry) => ({
        actionRef: String(entry.toolCallId),
        actionName: String(entry.toolName),
        input: entry.args,
      })) as ContextActionRequest[],
      messagesForModel: result.messagesForModel,
      llm: result.llm,
    }
  }
}
