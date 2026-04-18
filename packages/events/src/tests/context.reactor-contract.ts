import { expect } from "vitest"

import {
  CONTEXT_STREAM_CHUNK_TYPES,
  parseContextPartEnvelope,
  type ContextPartEnvelope,
  type ContextStepStreamChunk,
} from "../index.ts"
import { readPersistedContextStepStream } from "../runtime.ts"

type AnyRecord = Record<string, unknown>

export type EventDomainRunSnapshot = {
  context: AnyRecord
  execution: AnyRecord
  items: AnyRecord[]
  triggerItem: AnyRecord | null
  reactionItem: AnyRecord | null
  steps: AnyRecord[]
  partRows: AnyRecord[]
  parts: ContextPartEnvelope[]
  streamChunks: ContextStepStreamChunk[]
}

export type VerifyEventDomainRunParams = {
  db: any
  contextId: string
  executionId: string
  triggerEventId?: string
  reactionEventId: string
  durable?: boolean
  requireStepStream?: boolean
  expectedContextStatus?: string
  expectedExecutionStatus?: string
  expectedReactionStatus?: string
  expectedStepStatuses?: string[]
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function asRows(queryResult: unknown, key: string): AnyRecord[] {
  const root = asRecord(queryResult)
  const value = root[key]
  return Array.isArray(value) ? (value as AnyRecord[]) : []
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return ""
}

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function hasValue(value: unknown): boolean {
  if (value instanceof Date) return true
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  return value !== null && value !== undefined
}

function sortByCreatedAt(rows: AnyRecord[]) {
  return rows.slice().sort((a, b) => {
    const aMs = timestampMs(a.createdAt)
    const bMs = timestampMs(b.createdAt)
    if (aMs !== bMs) return aMs - bMs
    return asString(a.id).localeCompare(asString(b.id))
  })
}

function assertChronological(rows: AnyRecord[], label: string) {
  const sorted = sortByCreatedAt(rows)
  expect(rows.map((row) => asString(row.id)), `${label} ids should be ordered by createdAt`).toEqual(
    sorted.map((row) => asString(row.id)),
  )
}

export async function verifyEventDomainRun(
  params: VerifyEventDomainRunParams,
): Promise<EventDomainRunSnapshot> {
  const expectedContextStatus = params.expectedContextStatus ?? "closed"
  const expectedExecutionStatus = params.expectedExecutionStatus ?? "completed"
  const expectedReactionStatus = params.expectedReactionStatus ?? "completed"
  const expectedStepStatuses = params.expectedStepStatuses ?? ["completed"]

  const snapshot = await params.db.query({
    event_contexts: {
      $: { where: { id: params.contextId as any }, limit: 1 },
      currentExecution: {},
    },
    event_executions: {
      $: { where: { id: params.executionId as any }, limit: 1 },
      context: {},
      trigger: {},
      reaction: {},
    },
    event_items: {
      $: {
        where: { "context.id": params.contextId as any },
        order: { createdAt: "asc" },
        limit: 200,
      },
      execution: {},
    },
    event_steps: {
      $: {
        where: { "execution.id": params.executionId as any },
        order: { createdAt: "asc" },
        limit: 200,
      },
      execution: {},
    },
  })

  const context = asRows(snapshot, "event_contexts")[0]
  const execution = asRows(snapshot, "event_executions")[0]
  const items = asRows(snapshot, "event_items")
  const steps = asRows(snapshot, "event_steps")

  expect(context, "event_contexts row").toBeTruthy()
  expect(execution, "event_executions row").toBeTruthy()
  expect(asString(context.id)).toBe(params.contextId)
  expect(asString(execution.id)).toBe(params.executionId)
  expect(asString(context.status)).toBe(expectedContextStatus)
  expect(asString(execution.status)).toBe(expectedExecutionStatus)

  if (params.durable) {
    expect(asString(execution.workflowRunId)).toMatch(/^wrun_/)
  }

  const linkedExecutionContext = asRecord(execution.context)
  const linkedExecutionTrigger = asRecord(execution.trigger)
  const linkedExecutionReaction = asRecord(execution.reaction)
  if (asString(linkedExecutionContext.id)) {
    expect(asString(linkedExecutionContext.id)).toBe(params.contextId)
  }
  if (params.triggerEventId && asString(linkedExecutionTrigger.id)) {
    expect(asString(linkedExecutionTrigger.id)).toBe(params.triggerEventId)
  }
  if (asString(linkedExecutionReaction.id)) {
    expect(asString(linkedExecutionReaction.id)).toBe(params.reactionEventId)
  }

  expect(items.length).toBeGreaterThanOrEqual(2)
  assertChronological(items, "event_items")
  const inputItems = items.filter((item) => asString(item.type) === "input")
  const outputItems = items.filter((item) => asString(item.type) === "output")
  expect(inputItems.length).toBeGreaterThanOrEqual(1)
  expect(outputItems.length).toBeGreaterThanOrEqual(1)

  const triggerItem = params.triggerEventId
    ? items.find((item) => asString(item.id) === params.triggerEventId) ?? null
    : inputItems[0] ?? null
  const reactionItem =
    items.find((item) => asString(item.id) === params.reactionEventId) ?? null
  expect(triggerItem, "trigger event item").toBeTruthy()
  expect(reactionItem, "reaction event item").toBeTruthy()
  expect(asString(reactionItem?.type)).toBe("output")
  expect(asString(reactionItem?.status)).toBe(expectedReactionStatus)

  for (const item of items) {
    const itemExecution = asRecord(item.execution)
    if (asString(itemExecution.id)) {
      expect(asString(itemExecution.id)).toBe(params.executionId)
    }
  }

  expect(steps.length).toBeGreaterThan(0)
  assertChronological(steps, "event_steps")
  for (const step of steps) {
    expect(asString(step.id), "step.id").not.toBe("")
    expect(expectedStepStatuses).toContain(asString(step.status))
    const stepExecution = asRecord(step.execution)
    if (asString(stepExecution.id)) {
      expect(asString(stepExecution.id)).toBe(params.executionId)
    }
  }

  const partRows: AnyRecord[] = []
  for (const step of steps) {
    const stepId = asString(step.id)
    const partsSnapshot = await params.db.query({
      event_parts: {
        $: {
          where: { stepId: stepId as any },
          order: { idx: "asc" },
          limit: 500,
        },
        step: {},
      },
    })
    const rows = asRows(partsSnapshot, "event_parts")
    for (const row of rows) {
      partRows.push(row)
      expect(asString(row.stepId) || asString(asRecord(row.step).id)).toBe(stepId)
      expect(asString(row.key)).toBe(`${stepId}:${Number(row.idx)}`)
    }
  }
  expect(partRows.length).toBeGreaterThan(0)

  const parts = partRows.map((row) => parseContextPartEnvelope(row.part))
  expect(parts.length).toBe(partRows.length)

  const streamChunks: ContextStepStreamChunk[] = []
  const streamSteps = steps.filter(
    (step) => hasValue(step.streamClientId) || hasValue(step.streamId),
  )

  if (params.requireStepStream) {
    expect(streamSteps.length).toBeGreaterThan(0)
  }

  for (const step of streamSteps) {
    expect(step.streamAbortReason ?? null).toBeNull()
    expect(hasValue(step.streamFinishedAt)).toBe(true)
    const persistedStream = await readPersistedContextStepStream({
      db: params.db,
      clientId: asString(step.streamClientId) || undefined,
      streamId: asString(step.streamId) || undefined,
    })
    const chunks = persistedStream.chunks
    expect(chunks.length).toBeGreaterThan(0)
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      expect(CONTEXT_STREAM_CHUNK_TYPES).toContain(chunk.chunkType)
      if (index > 0) {
        expect(chunk.sequence).toBeGreaterThanOrEqual(chunks[index - 1]!.sequence)
      }
    }
    streamChunks.push(...chunks)
  }

  return {
    context,
    execution,
    items,
    triggerItem,
    reactionItem,
    steps,
    partRows,
    parts,
    streamChunks,
  }
}
