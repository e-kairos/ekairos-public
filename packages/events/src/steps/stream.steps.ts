import type { UIMessageChunk } from "ai"

import type { ContextEnvironment } from "../context.config.js"
import type { ContextRuntime } from "../context.runtime.js"
import { getContextRuntimeServices } from "../context.runtime.js"
import {
  contextStreamByteLength,
  parseContextStepStreamChunk,
  type ContextStepStreamChunk,
} from "../context.step-stream.js"
import type { ContextStreamEvent } from "../context.stream.js"

export async function writeContextEvents(params: {
  events: ContextStreamEvent[]
  writable?: WritableStream<UIMessageChunk>
}) {
  "use step"
  const writable = params.writable
  if (!writable || !params.events.length) return
  const writer = writable.getWriter()
  try {
    for (const event of params.events) {
      await writer.write({
        type: `data-${String(event.type)}`,
        data: event,
      } as any)
    }
  } finally {
    if (typeof (writer as any)?.releaseLock === "function") {
      writer.releaseLock()
    }
  }
}

export async function closeContextStream(params: {
  preventClose?: boolean
  sendFinish?: boolean
  writable?: WritableStream<UIMessageChunk>
}) {
  "use step"
  const sendFinish = params.sendFinish ?? true
  const preventClose = params.preventClose ?? false
  const writable = params.writable
  if (!writable) return

  if (sendFinish) {
    const writer = writable.getWriter()
    try {
      await writer.write({ type: "finish" } as any)
    } finally {
      if (typeof (writer as any)?.releaseLock === "function") {
        writer.releaseLock()
      }
    }
  }

  if (!preventClose) {
    await writable.close()
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function createUnsetStreamLinkTx(
  db: any,
  executionId: string,
  label: "activeStream" | "lastStream",
  streamId: string,
) {
  try {
    return db.tx.event_executions[executionId].unlink({ [label]: streamId })
  } catch {
    return null
  }
}

export function createContextStepStreamClientId(stepId: string): string {
  const normalized = String(stepId ?? "").trim()
  if (!normalized) {
    throw new Error("createContextStepStreamClientId: stepId is required.")
  }
  return `event-step:${normalized}`
}

export type PersistedContextStepStreamSession = {
  stream: WritableStream<string>
  streamId: string
  clientId: string
  executionId: string
  stepId: string
}

export async function createPersistedContextStepStreamForRuntime(
  runtime: { db?: any },
  params: {
    executionId: string
    stepId: string
    clientId?: string
  },
): Promise<PersistedContextStepStreamSession> {
  const db: any = (runtime as any)?.db
  if (!db?.streams?.createWriteStream) {
    throw new Error(
      "InstantDB streams are not available on the configured runtime. Upgrade @instantdb/admin to a streams-capable version.",
    )
  }

  const clientId = asString(params.clientId) || createContextStepStreamClientId(params.stepId)
  const startedAt = new Date()
  const writeStream = db.streams.createWriteStream({
    clientId,
  })
  const streamId = await writeStream.streamId()

  await db.transact(
    [
      db.tx.event_steps[params.stepId]
        .update({
          streamId,
          streamClientId: clientId,
          streamStartedAt: startedAt,
          streamFinishedAt: null,
          streamAbortReason: null,
          updatedAt: new Date(),
        })
        .link({ stream: streamId }),
      db.tx.event_executions[params.executionId]
        .update({
          activeStreamId: streamId,
          activeStreamClientId: clientId,
          lastStreamId: streamId,
          lastStreamClientId: clientId,
          updatedAt: new Date(),
        })
        .link({ activeStream: streamId, lastStream: streamId }),
    ] as any,
  )

  return {
    stream: writeStream as unknown as WritableStream<string>,
    streamId,
    clientId,
    executionId: params.executionId,
    stepId: params.stepId,
  }
}

export async function createPersistedContextStepStream(params: {
  runtime: ContextRuntime<ContextEnvironment>
  executionId: string
  stepId: string
  clientId?: string
}): Promise<PersistedContextStepStreamSession> {
  "use step"
  const runtime = await getContextRuntimeServices(params.runtime)
  return await createPersistedContextStepStreamForRuntime(runtime, params)
}

export async function finalizePersistedContextStepStreamForRuntime(params: {
  runtime: { db?: any }
  session: PersistedContextStepStreamSession
  mode: "close" | "abort"
  abortReason?: string | null
}) {
  const db: any = (params.runtime as any)?.db

  const writer = params.session.stream.getWriter()
  try {
    if (params.mode === "abort") {
      await writer.abort(params.abortReason ?? "aborted")
    } else {
      await writer.close()
    }
  } finally {
    if (typeof (writer as any)?.releaseLock === "function") {
      writer.releaseLock()
    }
  }

  const now = new Date()
  const txs: any[] = [
    db.tx.event_steps[params.session.stepId].update({
      streamFinishedAt: now,
      streamAbortReason:
        params.mode === "abort" ? params.abortReason ?? "aborted" : null,
      updatedAt: now,
    }),
    db.tx.event_executions[params.session.executionId].update({
      activeStreamId: null,
      activeStreamClientId: null,
      lastStreamId: params.session.streamId,
      lastStreamClientId: params.session.clientId,
      updatedAt: now,
    }),
  ]
  const unsetActive = createUnsetStreamLinkTx(
    db,
    params.session.executionId,
    "activeStream",
    params.session.streamId,
  )
  if (unsetActive) txs.push(unsetActive)
  await db.transact(txs as any)
}

async function finalizePersistedContextStepStream(params: {
  runtime: ContextRuntime<ContextEnvironment>
  session: PersistedContextStepStreamSession
  mode: "close" | "abort"
  abortReason?: string | null
}) {
  "use step"
  const runtime = await getContextRuntimeServices(params.runtime)
  return await finalizePersistedContextStepStreamForRuntime({
    runtime,
    session: params.session,
    mode: params.mode,
    abortReason: params.abortReason,
  })
}

export async function closePersistedContextStepStream(params: {
  runtime: ContextRuntime<ContextEnvironment>
  session: PersistedContextStepStreamSession
}) {
  return await finalizePersistedContextStepStream({
    runtime: params.runtime,
    session: params.session,
    mode: "close",
  })
}

export async function abortPersistedContextStepStream(params: {
  runtime: ContextRuntime<ContextEnvironment>
  session: PersistedContextStepStreamSession
  reason?: string | null
}) {
  return await finalizePersistedContextStepStream({
    runtime: params.runtime,
    session: params.session,
    mode: "abort",
    abortReason: params.reason,
  })
}

export async function readPersistedContextStepStream(params: {
  db: any
  clientId?: string
  streamId?: string
  byteOffset?: number
  onChunk?: (chunk: ContextStepStreamChunk) => Promise<void> | void
}) {
  if (!params.db?.streams?.createReadStream) {
    throw new Error("InstantDB streams are not available on the provided runtime.")
  }
  const clientId = asString(params.clientId)
  const streamId = asString(params.streamId)
  if (!clientId && !streamId) {
    throw new Error("readPersistedContextStepStream requires clientId or streamId.")
  }

  const startOffset =
    typeof params.byteOffset === "number" && Number.isFinite(params.byteOffset)
      ? Math.max(0, params.byteOffset)
      : 0

  const stream = params.db.streams.createReadStream({
    clientId: clientId || undefined,
    streamId: streamId || undefined,
    byteOffset: startOffset,
  })

  const chunks: ContextStepStreamChunk[] = []
  let byteOffset = startOffset
  let buffer = ""

  for await (const rawChunk of stream as any) {
    const encoded = typeof rawChunk === "string" ? rawChunk : String(rawChunk ?? "")
    if (!encoded) continue
    byteOffset += contextStreamByteLength(encoded)
    buffer += encoded

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parsed = parseContextStepStreamChunk(trimmed)
      chunks.push(parsed)
      await params.onChunk?.(parsed)
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const parsed = parseContextStepStreamChunk(trailing)
    chunks.push(parsed)
    await params.onChunk?.(parsed)
  }

  return {
    chunks,
    byteOffset,
  }
}

export async function resolveContextExecutionStreamPointer(params: {
  db: any
  contextId: string
}) {
  const snapshot = await params.db.query({
    event_contexts: {
      $: {
        where: { id: params.contextId as any },
        limit: 1,
      },
      currentExecution: {},
    },
  })
  const contextRow = Array.isArray(snapshot?.event_contexts)
    ? snapshot.event_contexts[0]
    : null
  const executionRow = asRecord(contextRow?.currentExecution)
  const executionId = asString(executionRow.id)
  if (!executionId) return null

  const activeStreamClientId = asString(executionRow.activeStreamClientId)
  const activeStreamId = asString(executionRow.activeStreamId)
  if (activeStreamClientId || activeStreamId) {
    return {
      executionId,
      status: asString(executionRow.status) || null,
      source: "active" as const,
      clientId: activeStreamClientId || null,
      streamId: activeStreamId || null,
    }
  }

  const lastStreamClientId = asString(executionRow.lastStreamClientId)
  const lastStreamId = asString(executionRow.lastStreamId)
  if (lastStreamClientId || lastStreamId) {
    return {
      executionId,
      status: asString(executionRow.status) || null,
      source: "last" as const,
      clientId: lastStreamClientId || null,
      streamId: lastStreamId || null,
    }
  }

  return {
    executionId,
    status: asString(executionRow.status) || null,
    source: "none" as const,
    clientId: null,
    streamId: null,
  }
}

export async function waitForContextExecutionStreamPointer(params: {
  db: any
  contextId: string
  timeoutMs?: number
  pollMs?: number
}) {
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(0, params.timeoutMs)
      : 15_000
  const pollMs =
    typeof params.pollMs === "number" && Number.isFinite(params.pollMs)
      ? Math.max(10, params.pollMs)
      : 125

  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const pointer = await resolveContextExecutionStreamPointer({
      db: params.db,
      contextId: params.contextId,
    })
    if (pointer && (pointer.clientId || pointer.streamId)) {
      return pointer
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  return null
}
