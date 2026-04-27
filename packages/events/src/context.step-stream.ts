import {
  isContextStreamChunkType,
  type ContextStreamChunkType,
} from "./context.contract.js"
import { assertValidContextPartChunkIdentity } from "./context.part-identity.js"

export const CONTEXT_STEP_STREAM_VERSION = 1 as const

export type ContextStepStreamChunk = {
  version: typeof CONTEXT_STEP_STREAM_VERSION
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  partId?: string
  providerPartId?: string
  partType?: string
  partSlot?: string
  provider?: string
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

export type ContextStepStreamChunkValidationOptions = {
  stepId?: string
  label?: string
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

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assertNumber(value, label)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: expected positive integer.`)
  }
}

function assertIsoDateString(value: unknown, label: string): asserts value is string {
  assertString(value, label)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}: expected ISO date string.`)
  }
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (typeof value === "undefined") return
  assertString(value, label)
}

export function createContextStepStreamChunk(params: {
  at?: string
  sequence: number
  chunkType: ContextStreamChunkType
  stepId?: string
  partId?: string
  providerPartId?: string
  partType?: string
  partSlot?: string
  provider?: string
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}): ContextStepStreamChunk {
  const chunk = {
    version: CONTEXT_STEP_STREAM_VERSION,
    at: params.at ?? new Date().toISOString(),
    sequence: params.sequence,
    chunkType: params.chunkType,
    partId: params.partId,
    providerPartId: params.providerPartId,
    partType: params.partType,
    partSlot: params.partSlot,
    provider: params.provider,
    providerChunkType: params.providerChunkType,
    actionRef: params.actionRef,
    data: params.data,
    raw: params.raw,
  }
  validateContextStepStreamChunk(chunk, {
    stepId: params.stepId,
    label: "context step stream chunk",
  })
  return chunk
}

export function validateContextStepStreamChunk(
  value: unknown,
  options: ContextStepStreamChunkValidationOptions = {},
): asserts value is ContextStepStreamChunk {
  const label = options.label ?? "context step stream chunk"
  assertObject(value, label)
  assertNumber(value.version, `${label}.version`)
  if (value.version !== CONTEXT_STEP_STREAM_VERSION) {
    throw new Error(
      `Unsupported ${label}.version: ${String(value.version)}`,
    )
  }
  assertIsoDateString(value.at, `${label}.at`)
  assertPositiveInteger(value.sequence, `${label}.sequence`)
  assertString(value.chunkType, `${label}.chunkType`)
  if (!isContextStreamChunkType(value.chunkType)) {
    throw new Error(
      `Invalid ${label}.chunkType: ${String(value.chunkType)}`,
    )
  }
  assertOptionalString(value.partId, `${label}.partId`)
  assertOptionalString(value.providerPartId, `${label}.providerPartId`)
  assertOptionalString(value.partType, `${label}.partType`)
  assertOptionalString(value.partSlot, `${label}.partSlot`)
  assertOptionalString(value.provider, `${label}.provider`)
  assertOptionalString(value.providerChunkType, `${label}.providerChunkType`)
  assertOptionalString(value.actionRef, `${label}.actionRef`)
  assertValidContextPartChunkIdentity({
    label,
    stepId: options.stepId,
    chunkType: value.chunkType,
    partId: value.partId,
    provider: value.provider,
    providerPartId: value.providerPartId,
    partType: value.partType,
    partSlot: value.partSlot,
    actionRef: value.actionRef,
  })
}

export function parseContextStepStreamChunk(
  value: string | unknown,
  options: ContextStepStreamChunkValidationOptions = {},
): ContextStepStreamChunk {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value

  validateContextStepStreamChunk(parsed, options)
  return parsed
}

export function encodeContextStepStreamChunk(
  chunk: ContextStepStreamChunk,
  options: ContextStepStreamChunkValidationOptions = {},
): string {
  validateContextStepStreamChunk(chunk, options)
  return `${JSON.stringify(chunk)}\n`
}

export function contextStreamByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
