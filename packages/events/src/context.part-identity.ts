import type { ContextStreamChunkType } from "./context.contract.js"

export const CONTEXT_PART_ID_NAMESPACE = "8be4c3a0-9e67-4f26-b60f-52b5b04d4b8d"
export const CONTEXT_PART_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const CONTEXT_STREAM_PART_TYPES = [
  "message",
  "reasoning",
  "source",
  "action",
] as const

export type ContextStreamPartType = (typeof CONTEXT_STREAM_PART_TYPES)[number]

export type ContextStreamPartSlot =
  | "message"
  | "reasoning"
  | "source"
  | "action:started"
  | "action:completed"
  | "action:failed"

export type ContextPartChunkIdentityInput = {
  stepId?: string
  provider?: string
  providerPartId?: string
  chunkType: ContextStreamChunkType | string
  partType?: ContextStreamPartType | string
  partSlot?: ContextStreamPartSlot | string
}

export type ContextPartChunkValidationInput = ContextPartChunkIdentityInput & {
  partId?: string
  actionRef?: string
  label?: string
}

export type ContextPartChunkDescriptor = {
  providerPartId: string
  partType: ContextStreamPartType
  partSlot: ContextStreamPartSlot
}

export type ContextPartChunkIdentity = ContextPartChunkDescriptor & {
  partId: string
}

const TEXT_ENCODER = new TextEncoder()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_SEPARATOR = "\u001f"

function normalizeIdentityField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function fieldLabel(label: string, field: string): string {
  return `${label}.${field}`
}

function assertMissingPartIdentityField(value: unknown, label: string) {
  if (typeof value !== "undefined") {
    throw new Error(`Invalid ${label}: lifecycle/metadata chunks cannot carry part identity.`)
  }
}

function assertPartIdentityString(value: unknown, label: string): string {
  const normalized = normalizeIdentityField(value)
  if (!normalized) {
    throw new Error(`Invalid ${label}: expected non-empty string.`)
  }
  return normalized
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8
  const totalLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64
  const message = new Uint8Array(totalLength)
  message.set(bytes)
  message[bytes.length] = 0x80

  const view = new DataView(message.buffer)
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(totalLength - 4, bitLength >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const words = new Uint32Array(80)

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!, 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i += 1) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const temp = (rotateLeft(a, 5) + f + e + k + words[i]!) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, h0, false)
  outView.setUint32(4, h1, false)
  outView.setUint32(8, h2, false)
  outView.setUint32(12, h3, false)
  outView.setUint32(16, h4, false)
  return out
}

function uuidToBytes(uuid: string): Uint8Array {
  const normalized = uuid.trim().toLowerCase()
  if (!UUID_RE.test(normalized)) {
    throw new Error(`Invalid UUID namespace: ${uuid}`)
  }

  const hex = normalized.replace(/-/g, "")
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

export function uuidV5(name: string, namespace = CONTEXT_PART_ID_NAMESPACE): string {
  const namespaceBytes = uuidToBytes(namespace)
  const nameBytes = TEXT_ENCODER.encode(name)
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
  input.set(namespaceBytes)
  input.set(nameBytes, namespaceBytes.length)

  const bytes = sha1(input).slice(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return formatUuid(bytes)
}

export function resolveContextStreamPartType(
  chunkType: ContextStreamChunkType | string,
): ContextStreamPartType | undefined {
  if (
    chunkType === "chunk.text_start" ||
    chunkType === "chunk.text_delta" ||
    chunkType === "chunk.text_end" ||
    chunkType === "chunk.file"
  ) {
    return "message"
  }

  if (
    chunkType === "chunk.reasoning_start" ||
    chunkType === "chunk.reasoning_delta" ||
    chunkType === "chunk.reasoning_end"
  ) {
    return "reasoning"
  }

  if (chunkType === "chunk.source_url" || chunkType === "chunk.source_document") {
    return "source"
  }

  if (
    chunkType === "chunk.action_input_start" ||
    chunkType === "chunk.action_input_delta" ||
    chunkType === "chunk.action_input_available" ||
    chunkType === "chunk.action_output_available" ||
    chunkType === "chunk.action_output_error"
  ) {
    return "action"
  }

  return undefined
}

export function resolveContextStreamPartSlot(
  chunkType: ContextStreamChunkType | string,
  partType = resolveContextStreamPartType(chunkType),
): ContextStreamPartSlot | undefined {
  if (partType === "message") return "message"
  if (partType === "reasoning") return "reasoning"
  if (partType === "source") return "source"

  if (partType === "action") {
    if (chunkType === "chunk.action_output_error") return "action:failed"
    if (chunkType === "chunk.action_output_available") return "action:completed"
    return "action:started"
  }

  return undefined
}

export function resolveContextPartChunkDescriptor(
  input: ContextPartChunkIdentityInput,
): ContextPartChunkDescriptor | undefined {
  const providerPartId = normalizeIdentityField(input.providerPartId)
  if (!providerPartId) return undefined

  const inferredPartType = resolveContextStreamPartType(input.chunkType)
  const partType = normalizeIdentityField(input.partType || inferredPartType) as ContextStreamPartType
  if (!(CONTEXT_STREAM_PART_TYPES as readonly string[]).includes(partType)) {
    return undefined
  }

  const partSlot = normalizeIdentityField(
    input.partSlot || resolveContextStreamPartSlot(input.chunkType, partType),
  ) as ContextStreamPartSlot
  if (!partSlot) return undefined

  return {
    providerPartId,
    partType,
    partSlot,
  }
}

export function resolveContextPartId(input: {
  stepId: string
  provider: string
  providerPartId: string
  partType: string
  partSlot: string
}): string {
  const name = [
    "context-part:v1",
    input.stepId,
    input.provider,
    input.providerPartId,
    input.partType,
    input.partSlot,
  ].join(ID_SEPARATOR)
  return uuidV5(name)
}

export function resolveContextPartChunkIdentity(
  input: ContextPartChunkIdentityInput,
): ContextPartChunkIdentity | undefined {
  const descriptor = resolveContextPartChunkDescriptor(input)
  const stepId = normalizeIdentityField(input.stepId)
  if (!descriptor || !stepId) return undefined

  const provider = normalizeIdentityField(input.provider) || "unknown"
  return {
    ...descriptor,
    partId: resolveContextPartId({
      stepId,
      provider,
      providerPartId: descriptor.providerPartId,
      partType: descriptor.partType,
      partSlot: descriptor.partSlot,
    }),
  }
}

export function assertValidContextPartChunkIdentity(
  input: ContextPartChunkValidationInput,
): void {
  const label = normalizeIdentityField(input.label) || "context stream chunk"
  const expectedPartType = resolveContextStreamPartType(input.chunkType)

  if (!expectedPartType) {
    assertMissingPartIdentityField(input.partId, fieldLabel(label, "partId"))
    assertMissingPartIdentityField(input.providerPartId, fieldLabel(label, "providerPartId"))
    assertMissingPartIdentityField(input.partType, fieldLabel(label, "partType"))
    assertMissingPartIdentityField(input.partSlot, fieldLabel(label, "partSlot"))
    if (typeof input.actionRef !== "undefined") {
      throw new Error(`Invalid ${fieldLabel(label, "actionRef")}: only action chunks can carry actionRef.`)
    }
    return
  }

  const expectedPartSlot = resolveContextStreamPartSlot(input.chunkType, expectedPartType)
  const partId = assertPartIdentityString(input.partId, fieldLabel(label, "partId"))
  if (!CONTEXT_PART_UUID_RE.test(partId)) {
    throw new Error(`Invalid ${fieldLabel(label, "partId")}: expected deterministic UUID v5.`)
  }

  const provider = assertPartIdentityString(input.provider, fieldLabel(label, "provider"))
  const providerPartId = assertPartIdentityString(
    input.providerPartId,
    fieldLabel(label, "providerPartId"),
  )
  const partType = assertPartIdentityString(input.partType, fieldLabel(label, "partType"))
  const partSlot = assertPartIdentityString(input.partSlot, fieldLabel(label, "partSlot"))

  if (partType !== expectedPartType) {
    throw new Error(
      `Invalid ${fieldLabel(label, "partType")}: ${String(input.chunkType)} requires ${expectedPartType}.`,
    )
  }
  if (partSlot !== expectedPartSlot) {
    throw new Error(
      `Invalid ${fieldLabel(label, "partSlot")}: ${String(input.chunkType)} requires ${expectedPartSlot}.`,
    )
  }

  const isActionChunk = expectedPartType === "action"
  if (!isActionChunk && typeof input.actionRef !== "undefined") {
    throw new Error(`Invalid ${fieldLabel(label, "actionRef")}: only action chunks can carry actionRef.`)
  }
  if (isActionChunk && typeof input.actionRef !== "undefined") {
    assertPartIdentityString(input.actionRef, fieldLabel(label, "actionRef"))
  }

  const stepId = normalizeIdentityField(input.stepId)
  if (!stepId) return

  const expectedPartId = resolveContextPartId({
    stepId,
    provider,
    providerPartId,
    partType,
    partSlot,
  })
  if (partId !== expectedPartId) {
    throw new Error(
      `Invalid ${fieldLabel(label, "partId")}: expected ${expectedPartId} for deterministic part identity.`,
    )
  }
}
