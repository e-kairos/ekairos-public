import {
  isContextStreamChunkType,
  type ContextStreamChunkType,
} from "./context.contract.js"

export const CONTEXT_STEP_STREAM_VERSION = 1 as const

export type ContextStepStreamChunk = {
  version: typeof CONTEXT_STEP_STREAM_VERSION
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  provider?: string
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid ${label}: expected object.`)
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${label}: expected non-empty string.`)
  }
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Invalid ${label}: expected number.`)
  }
}

function assertOptionalString(value: unknown, label: string) {
  if (typeof value === "undefined") return
  assertString(value, label)
}

export function createContextStepStreamChunk(params: {
  at?: string
  sequence: number
  chunkType: ContextStreamChunkType
  provider?: string
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}): ContextStepStreamChunk {
  return {
    version: CONTEXT_STEP_STREAM_VERSION,
    at: params.at ?? new Date().toISOString(),
    sequence: params.sequence,
    chunkType: params.chunkType,
    provider: params.provider,
    providerChunkType: params.providerChunkType,
    actionRef: params.actionRef,
    data: params.data,
    raw: params.raw,
  }
}

export function parseContextStepStreamChunk(value: string | unknown): ContextStepStreamChunk {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value

  assertObject(parsed, "context step stream chunk")
  assertNumber(parsed.version, "context step stream chunk.version")
  if (parsed.version !== CONTEXT_STEP_STREAM_VERSION) {
    throw new Error(
      `Unsupported context step stream chunk version: ${String(parsed.version)}`,
    )
  }
  assertString(parsed.at, "context step stream chunk.at")
  assertNumber(parsed.sequence, "context step stream chunk.sequence")
  assertString(parsed.chunkType, "context step stream chunk.chunkType")
  if (!isContextStreamChunkType(parsed.chunkType)) {
    throw new Error(
      `Invalid context step stream chunk.chunkType: ${String(parsed.chunkType)}`,
    )
  }
  assertOptionalString(parsed.provider, "context step stream chunk.provider")
  assertOptionalString(
    parsed.providerChunkType,
    "context step stream chunk.providerChunkType",
  )
  assertOptionalString(parsed.actionRef, "context step stream chunk.actionRef")

  return parsed as ContextStepStreamChunk
}

export function encodeContextStepStreamChunk(chunk: ContextStepStreamChunk): string {
  return `${JSON.stringify(chunk)}\n`
}

export function contextStreamByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
