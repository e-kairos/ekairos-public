import {
  OUTPUT_ITEM_TYPE,
  type ContextItem,
  type ContextReactionResult,
  type ContextReactor,
  type ContextReactorParams,
} from "@ekairos/events"
import type { ContextEnvironment } from "@ekairos/events/runtime"

type AnyRecord = Record<string, unknown>

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

export type CursorTurnResult = {
  text: string
  metadata?: Record<string, unknown>
}

export type CreateCursorReactorOptions<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  executeTurn: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ContextItem
    contextId: string
    executionId: string
    stepId: string
    iteration: number
    writable?: WritableStream<unknown>
    silent: boolean
  }) => Promise<CursorTurnResult>
}

/**
 * Cursor Agent reactor scaffold.
 *
 * Integrators provide `executeTurn` (prefer a `"use step"` function) and Context
 * keeps durability, persistence and step lifecycle.
 */
export function createCursorReactor<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  options: CreateCursorReactorOptions<Context, Env>,
): ContextReactor<Context, Env> {
  return async (
    params: ContextReactorParams<Context, Env>,
  ): Promise<ContextReactionResult> => {
    const context = asRecord(params.context.content)
    const turn = await options.executeTurn({
      env: params.env,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
      writable: params.writable,
      silent: params.silent,
    })

    const assistantEvent: ContextItem = {
      id: params.eventId,
      type: OUTPUT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [{ type: "text", text: asString(turn.text).trim() }],
      },
    }

    return {
      assistantEvent,
      actionRequests: [],
      messagesForModel: [],
      llm: {
        provider: "cursor",
        model: "cursor-agent",
        rawProviderMetadata: turn.metadata,
      },
    }
  }
}
