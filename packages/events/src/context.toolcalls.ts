/**
 * ## context.toolcalls.ts
 *
 * This module isolates the **action-call plumbing** used by `context.engine.ts`.
 *
 * In our runtime, model tool calls are normalized into semantic `action` event parts.
 * The engine needs to:
 * - extract a normalized list of action requests from `event.content.parts`, and
 * - merge action execution outcomes back into those parts.
 *
 * Keeping this logic here helps `context.engine.ts` read like orchestration, and keeps
 * these transformations testable and reusable.
 */

import type { ContextItem } from "./context.store.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
  type ContextPartEnvelope,
} from "./context.parts.js"

export type ToolCall = {
  toolCallId: string
  toolName: string
  args: any
}

/**
 * Extracts action requests from an event's `parts` array.
 *
 * Also accepts raw AI SDK tool UI parts before persistence normalization.
 */
export function extractToolCallsFromParts(parts: any[] | undefined | null): ToolCall[] {
  const safeParts = parts ?? []
  return safeParts.reduce((acc: ToolCall[], p: any) => {
    if (isContextPartEnvelope(p) && p.type === "action" && p.content.status === "started") {
      acc.push({
        toolCallId: p.content.actionCallId,
        toolName: p.content.actionName,
        args: p.content.input,
      })
      return acc
    }

    if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
      const toolName = p.type.split("-").slice(1).join("-")
      acc.push({ toolCallId: p.toolCallId, toolName, args: p.input })
    }
    return acc
  }, [])
}

/**
 * Applies an action execution outcome to the matching action part.
 *
 * This does not mutate `parts` — it returns a new array.
 *
 * We match by action name and action call id.
 */
export function applyToolExecutionResultToParts(
  parts: any[],
  toolCall: Pick<ToolCall, "toolCallId" | "toolName">,
  execution: { success: boolean; result: any; message?: string },
): any[] {
  const normalized = normalizePartsForPersistence(parts)
  const next: ContextPartEnvelope[] = []
  let insertedResult = false

  for (const part of normalized) {
    next.push(part)
    if (part.type !== "action" || part.content.status !== "started") {
      continue
    }

    if (
      part.content.actionCallId !== toolCall.toolCallId ||
      part.content.actionName !== toolCall.toolName
    ) {
      continue
    }

    next.push(
      execution.success
        ? {
            type: "action",
            content: {
              status: "completed",
              actionCallId: toolCall.toolCallId,
              actionName: toolCall.toolName,
              output: execution.result,
            },
          }
        : {
            type: "action",
            content: {
              status: "failed",
              actionCallId: toolCall.toolCallId,
              actionName: toolCall.toolName,
              error: {
                message: String(execution.message || "Error"),
              },
            },
          },
    )

    insertedResult = true
  }

  if (!insertedResult) {
    next.push(
      execution.success
        ? {
            type: "action",
            content: {
              status: "completed",
              actionCallId: toolCall.toolCallId,
              actionName: toolCall.toolName,
              output: execution.result,
            },
          }
        : {
            type: "action",
            content: {
              status: "failed",
              actionCallId: toolCall.toolCallId,
              actionName: toolCall.toolName,
              error: {
                message: String(execution.message || "Error"),
              },
            },
          },
    )
  }

  return next
}

/**
 * Returns `true` when a given tool has a **settled** execution result in an event's parts.
 *
 * We treat a tool part as "executed" once it has either:
 * - `state: "output-available"` (success), or
 * - `state: "output-error"` (failure).
 *
 * This is useful for stop/continue logic in `context.shouldContinue(...)` where you want to
 * decide based on the persisted `reactionEvent` (not ephemeral in-memory arrays).
 */
export function didToolExecute(event: Pick<ContextItem, "content">, toolName: string): boolean {
  const parts = (((event as any).content.parts ?? []) as any[]).flatMap((part) =>
    isContextPartEnvelope(part) ? [part] : normalizePartsForPersistence([part]),
  )
  return parts.some(
    (p) =>
      (p.type === "action" &&
        p.content.actionName === toolName &&
        (p.content.status === "completed" || p.content.status === "failed")) ||
      ((p as any).type === `tool-${toolName}` &&
        ((p as any).state === "output-available" || (p as any).state === "output-error")),
  )
}


