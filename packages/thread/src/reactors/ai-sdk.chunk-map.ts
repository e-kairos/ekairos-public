import type { UIMessageChunk } from "ai"

import type { ThreadStreamChunkType } from "../thread.contract.js"
import type { ChunkEmittedEvent } from "../thread.stream.js"

const REDACT_KEY = /token|authorization|cookie|secret|api[_-]?key|password/i

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "undefined") return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function sanitizeRaw(value: unknown): unknown {
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(
      JSON.stringify(value, (key, currentValue) => {
        if (REDACT_KEY.test(key)) return "[redacted]"
        if (typeof currentValue === "string" && currentValue.length > 20_000) {
          return "[truncated-string]"
        }
        if (currentValue && typeof currentValue === "object") {
          if (seen.has(currentValue)) return "[circular]"
          seen.add(currentValue)
        }
        return currentValue
      }),
    )
  } catch {
    return undefined
  }
}

function mapAiSdkChunkType(providerChunkType: string): ThreadStreamChunkType {
  switch (providerChunkType) {
    case "start":
    case "stream-start":
      return "chunk.start"
    case "start-step":
      return "chunk.start_step"
    case "finish-step":
      return "chunk.finish_step"
    case "finish":
      return "chunk.finish"
    case "text-start":
      return "chunk.text_start"
    case "text-delta":
      return "chunk.text_delta"
    case "text-end":
      return "chunk.text_end"
    case "reasoning-start":
      return "chunk.reasoning_start"
    case "reasoning-delta":
      return "chunk.reasoning_delta"
    case "reasoning-end":
      return "chunk.reasoning_end"
    case "tool-input-start":
    case "tool-call-start":
      return "chunk.action_input_start"
    case "tool-input-delta":
    case "tool-call-delta":
      return "chunk.action_input_delta"
    case "tool-input-available":
    case "tool-input-end":
    case "tool-call":
    case "tool-call-end":
      return "chunk.action_input_available"
    case "tool-output-available":
      return "chunk.action_output_available"
    case "tool-output-error":
      return "chunk.action_output_error"
    case "source-url":
      return "chunk.source_url"
    case "source-document":
      return "chunk.source_document"
    case "file":
      return "chunk.file"
    case "message-metadata":
      return "chunk.message_metadata"
    case "response-metadata":
      return "chunk.response_metadata"
    case "error":
      return "chunk.error"
    default:
      return "chunk.unknown"
  }
}

function buildNormalizedData(chunk: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  const fields = [
    "id",
    "text",
    "delta",
    "state",
    "toolName",
    "toolCallId",
    "finishReason",
    "url",
    "title",
    "name",
    "mimeType",
  ] as const
  for (const field of fields) {
    const value = chunk[field]
    if (typeof value !== "undefined") {
      normalized[field] = value
    }
  }
  if (Object.keys(normalized).length === 0) {
    return {}
  }
  return (toJsonSafe(normalized) as Record<string, unknown>) ?? {}
}

export type MapAiSdkChunkToThreadEventParams = {
  chunk: UIMessageChunk | Record<string, unknown>
  contextId: string
  executionId?: string
  stepId?: string
  itemId?: string
  provider?: string
  sequence: number
}

export function mapAiSdkChunkToThreadEvent(
  params: MapAiSdkChunkToThreadEventParams,
): ChunkEmittedEvent {
  const chunk = asRecord(params.chunk)
  const providerChunkType = readString(chunk, "type") ?? "unknown"
  const chunkType = mapAiSdkChunkType(providerChunkType)

  const actionRef =
    readString(chunk, "toolCallId") ??
    readString(chunk, "id")

  return {
    type: "chunk.emitted",
    at: new Date().toISOString(),
    chunkType,
    contextId: params.contextId,
    executionId: params.executionId,
    stepId: params.stepId,
    itemId: params.itemId,
    actionRef: chunkType.startsWith("chunk.action_") ? actionRef : undefined,
    provider: params.provider,
    providerChunkType,
    sequence: params.sequence,
    data: buildNormalizedData(chunk),
    raw: sanitizeRaw(chunk),
  }
}
