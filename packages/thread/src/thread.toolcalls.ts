/**
 * ## thread.toolcalls.ts
 *
 * This module isolates the **tool-call plumbing** used by `thread.engine.ts`.
 *
 * In our runtime, tool calls are represented as **event parts** produced by the AI SDK.
 * The engine needs to:
 * - extract a normalized list of tool calls from `event.content.parts`, and
 * - merge tool execution outcomes back into those parts (so the persisted event reflects
 *   `output-available` / `output-error`, etc.).
 *
 * Keeping this logic here helps `thread.engine.ts` read like orchestration, and keeps
 * these transformations testable and reusable.
 */

import type { ThreadItem } from "./thread.store.js"

export type ToolCall = {
  toolCallId: string
  toolName: string
  args: any
}

/**
 * Extracts tool calls from an event's `parts` array.
 *
 * Expected part shape (loosely):
 * - `type`: string like `"tool-<toolName>"`
 * - `toolCallId`: string
 * - `input`: any (tool args)
 *
 * We intentionally treat the input as `any` because the part schema is produced by the AI SDK.
 */
export function extractToolCallsFromParts(parts: any[] | undefined | null): ToolCall[] {
  const safeParts = parts ?? []
  return safeParts.reduce((acc: ToolCall[], p: any) => {
    if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
      const toolName = p.type.split("-").slice(1).join("-")
      acc.push({ toolCallId: p.toolCallId, toolName, args: p.input })
    }
    return acc
  }, [])
}

/**
 * Applies a tool execution outcome to the matching tool part.
 *
 * This does not mutate `parts` — it returns a new array.
 *
 * We match the tool part by:
 * - `type === "tool-<toolName>"` and
 * - `toolCallId` equality
 *
 * Then we set:
 * - on success: `{ state: "output-available", output: <result> }`
 * - on failure: `{ state: "output-error", errorText: <message> }`
 */
export function applyToolExecutionResultToParts(
  parts: any[],
  toolCall: Pick<ToolCall, "toolCallId" | "toolName">,
  execution: { success: boolean; result: any; message?: string },
): any[] {
  return parts.map((p: any) => {
    if (p?.type === `tool-${toolCall.toolName}` && p.toolCallId === toolCall.toolCallId) {
      if (execution.success) {
        return { ...p, state: "output-available", output: execution.result }
      }
      return { ...p, state: "output-error", errorText: String(execution.message || "Error") }
    }
    return p
  })
}

/**
 * Returns `true` when a given tool has a **settled** execution result in an event's parts.
 *
 * We treat a tool part as "executed" once it has either:
 * - `state: "output-available"` (success), or
 * - `state: "output-error"` (failure).
 *
 * This is useful for stop/continue logic in `thread.shouldContinue(...)` where you want to
 * decide based on the persisted `reactionEvent` (not ephemeral in-memory arrays).
 */
export function didToolExecute(event: Pick<ThreadItem, "content">, toolName: string): boolean {
  type ToolPart = {
    type: string
    state?: "output-available" | "output-error" | string
  }

  const parts = (event as any).content.parts as ToolPart[]
  return parts.some(
    (p) =>
      p.type === `tool-${toolName}` &&
      (p.state === "output-available" || p.state === "output-error"),
  )
}


