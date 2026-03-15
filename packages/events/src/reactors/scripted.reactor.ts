import type { ModelMessage } from "ai"

import type { ContextEnvironment } from "../context.config.js"
import type { ContextItem } from "../context.store.js"
import { OUTPUT_ITEM_TYPE } from "../context.events.js"
import type {
  ContextReactionLLM,
  ContextActionRequest,
  ContextReactor,
  ContextReactorParams,
} from "./types.js"

type ScriptedReactionPayload = {
  assistantEvent?: Partial<ContextItem>
  actionRequests?: ContextActionRequest[]
  messagesForModel?: ModelMessage[]
  llm?: ContextReactionLLM
}

export type ScriptedReactorStep<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
> =
  | ScriptedReactionPayload
  | ((
      params: ContextReactorParams<Context, Env>,
    ) => Promise<ScriptedReactionPayload> | ScriptedReactionPayload)

export type CreateScriptedReactorOptions<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  steps: ScriptedReactorStep<Context, Env>[]
  repeatLast?: boolean
}

function normalizeScriptedAssistantEvent<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  params: ContextReactorParams<Context, Env>,
  assistantEvent?: Partial<ContextItem>,
): ContextItem {
  const fallback: ContextItem = {
    id: params.eventId,
    type: OUTPUT_ITEM_TYPE,
    channel: params.triggerEvent.channel,
    createdAt: new Date().toISOString(),
    content: { parts: [] },
  }

  const mergedContent = {
    ...fallback.content,
    ...(assistantEvent?.content ?? {}),
  }

  return {
    ...fallback,
    ...assistantEvent,
    id: assistantEvent?.id ?? fallback.id,
    createdAt: assistantEvent?.createdAt ?? fallback.createdAt,
    content: mergedContent,
  }
}

export function createScriptedReactor<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  options: CreateScriptedReactorOptions<Context, Env>,
): ContextReactor<Context, Env> {
  const steps = Array.isArray(options.steps) ? options.steps : []
  if (steps.length === 0) {
    throw new Error("createScriptedReactor: options.steps must contain at least one step.")
  }

  let index = 0

  return async (params) => {
    const hasCurrentStep = index < steps.length
    if (!hasCurrentStep && !options.repeatLast) {
      throw new Error(
        `createScriptedReactor: no scripted step available at index ${index}. ` +
          `Provided steps=${steps.length}. Enable repeatLast to reuse the final step.`,
      )
    }

    const stepIndex = hasCurrentStep ? index : steps.length - 1
    const scriptedStep = steps[stepIndex]
    if (hasCurrentStep) {
      index += 1
    }

    const payload =
      typeof scriptedStep === "function"
        ? await scriptedStep(params)
        : scriptedStep

    return {
      assistantEvent: normalizeScriptedAssistantEvent(params, payload.assistantEvent),
      actionRequests: Array.isArray(payload.actionRequests) ? payload.actionRequests : [],
      messagesForModel: Array.isArray(payload.messagesForModel)
        ? payload.messagesForModel
        : [],
      llm: payload.llm,
    }
  }
}
