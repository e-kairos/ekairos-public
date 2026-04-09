/**
 * ## context.toolcalls.ts
 *
 * This module isolates the **tool-call plumbing** used by `context.engine.ts`.
 *
 * In our runtime, tool calls are represented as **event parts** produced by the AI SDK.
 * The engine needs to:
 * - extract a normalized list of tool calls from `event.content.parts`, and
 * - merge tool execution outcomes back into those parts (so the persisted event reflects
 *   `output-available` / `output-error`, etc.).
 *
 * Keeping this logic here helps `context.engine.ts` read like orchestration, and keeps
 * these transformations testable and reusable.
 */

import type { ContextItem } from "./context.store.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
  normalizeToolResultContentToBlocks,
  type ContextInlineContent,
  type ContextPartEnvelope,
} from "./context.parts.js"

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
    if (isContextPartEnvelope(p) && p.type === "tool-call") {
      const firstContent = Array.isArray(p.content) ? p.content[0] : undefined
      const args =
        firstContent && firstContent.type === "json" ? firstContent.value : p.content
      acc.push({
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        args,
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
  const normalized = normalizePartsForPersistence(parts)
  const next: ContextPartEnvelope[] = []
  let insertedResult = false
  const resultContent: ContextInlineContent[] = execution.success
    ? normalizeToolResultContentToBlocks(execution.result)
    : [
        {
          type: "text" as const,
          text: String(execution.message || "Error"),
        },
      ]

  for (const part of normalized) {
    next.push(part)
    if (part.type !== "tool-call") {
      continue
    }

    if (
      part.toolCallId !== toolCall.toolCallId ||
      part.toolName !== toolCall.toolName
    ) {
      continue
    }

    next.push({
      type: "tool-result",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      state: execution.success ? "output-available" : "output-error",
      content: resultContent,
    })

    insertedResult = true
  }

  if (!insertedResult) {
    next.push({
      type: "tool-result",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      state: execution.success ? "output-available" : "output-error",
      content: resultContent,
    })
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
      (p.type === "tool-result" &&
        p.toolName === toolName &&
        (p.state === "output-available" || p.state === "output-error")) ||
      ((p as any).type === `tool-${toolName}` &&
        ((p as any).state === "output-available" || (p as any).state === "output-error")),
  )
}


