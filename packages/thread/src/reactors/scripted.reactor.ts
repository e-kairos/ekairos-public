import type { ModelMessage } from "ai"

import type { ThreadEnvironment } from "../thread.config.js"
import type { ThreadItem } from "../thread.store.js"
import type {
  ThreadReactionLLM,
  ThreadReactionToolCall,
  ThreadReactor,
  ThreadReactorParams,
} from "./types.js"

type ScriptedReactionPayload = {
  assistantEvent?: Partial<ThreadItem>
  toolCalls?: ThreadReactionToolCall[]
  messagesForModel?: ModelMessage[]
  llm?: ThreadReactionLLM
}

export type ScriptedReactorStep<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> =
  | ScriptedReactionPayload
  | ((
      params: ThreadReactorParams<Context, Env>,
    ) => Promise<ScriptedReactionPayload> | ScriptedReactionPayload)

export type CreateScriptedReactorOptions<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  steps: ScriptedReactorStep<Context, Env>[]
  repeatLast?: boolean
}

function normalizeScriptedAssistantEvent<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
>(
  params: ThreadReactorParams<Context, Env>,
  assistantEvent?: Partial<ThreadItem>,
): ThreadItem {
  const fallback: ThreadItem = {
    id: params.eventId,
    type: "output_text",
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

/**
 * Deterministic reactor used for tests and local loop iteration.
 *
 * - No model/network calls
 * - Predictable scripted outputs per iteration
 */
export function createScriptedReactor<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
>(
  options: CreateScriptedReactorOptions<Context, Env>,
): ThreadReactor<Context, Env> {
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
      toolCalls: Array.isArray(payload.toolCalls) ? payload.toolCalls : [],
      messagesForModel: Array.isArray(payload.messagesForModel)
        ? payload.messagesForModel
        : [],
      llm: payload.llm,
    }
  }
}

