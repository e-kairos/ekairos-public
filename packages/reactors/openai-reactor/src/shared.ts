import type { ThreadItem } from "@ekairos/thread"

export type AnyRecord = Record<string, unknown>

export function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

export function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  const out: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    const partType = asString(record.type)
    if (partType === "text") {
      const value = asString(record.text).trim()
      if (value) out.push(value)
      continue
    }
    if (partType === "input_text") {
      const value = asString(record.input_text || record.text).trim()
      if (value) out.push(value)
      continue
    }
    const inline = asString(record.text).trim()
    if (inline) out.push(inline)
  }
  return out.join("\n").trim()
}

export function defaultInstructionFromTrigger(event: ThreadItem): string {
  const content = asRecord(event.content)
  const message = textFromParts(content.parts)
  return message || "Continue with the current task."
}

export function buildCodexParts(params: {
  toolName: string
  includeReasoningPart: boolean
  result: {
    threadId: string
    turnId: string
    assistantText: string
    reasoningText?: string
    diff?: string
    toolParts?: unknown[]
    metadata?: Record<string, unknown>
  }
  instruction: string
  streamTrace?: unknown
}) {
  const parts: AnyRecord[] = []
  const assistantText = asString(params.result.assistantText).trim()
  const reasoningText = asString(params.result.reasoningText).trim()

  if (assistantText) {
    parts.push({ type: "text", text: assistantText })
  }

  if (params.includeReasoningPart && reasoningText) {
    parts.push({ type: "reasoning", text: reasoningText })
  }

  const metadata = {
    threadId: params.result.threadId,
    turnId: params.result.turnId,
    diff: params.result.diff ?? "",
    toolParts: params.result.toolParts ?? [],
    streamTrace: params.streamTrace,
    ...(params.result.metadata ?? {}),
  }

  parts.push({
    type: "codex-event",
    toolName: params.toolName,
    toolCallId: params.result.turnId || params.result.threadId,
    state: "output-available",
    input: { instruction: params.instruction },
    output: metadata,
    metadata: {
      ...metadata,
      eventType: "codex-event",
    },
  })

  return parts
}

