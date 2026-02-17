import {
  OUTPUT_TEXT_ITEM_TYPE,
  type ThreadItem,
  type ThreadReactionResult,
  type ThreadReactor,
  type ThreadReactorParams,
} from "@ekairos/thread"
import type { ThreadEnvironment } from "@ekairos/thread/runtime"

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
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  executeTurn: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ThreadItem
    contextId: string
    executionId: string
    stepId: string
    iteration: number
    writable?: unknown
    silent: boolean
  }) => Promise<CursorTurnResult>
}

/**
 * Cursor Agent reactor scaffold.
 *
 * Integrators provide `executeTurn` (prefer a `"use step"` function) and Thread
 * keeps durability, persistence and step lifecycle.
 */
export function createCursorReactor<
  Context,
  Env extends ThreadEnvironment = ThreadEnvironment,
>(
  options: CreateCursorReactorOptions<Context, Env>,
): ThreadReactor<Context, Env> {
  return async (
    params: ThreadReactorParams<Context, Env>,
  ): Promise<ThreadReactionResult> => {
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

    const assistantEvent: ThreadItem = {
      id: params.eventId,
      type: OUTPUT_TEXT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [{ type: "text", text: asString(turn.text).trim() }],
      },
    }

    return {
      assistantEvent,
      toolCalls: [],
      messagesForModel: [],
      llm: {
        provider: "cursor",
        model: "cursor-agent",
        rawProviderMetadata: turn.metadata,
      },
    }
  }
}
