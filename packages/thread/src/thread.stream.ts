import type {
  ThreadContextStatus,
  ThreadExecutionStatus,
  ThreadItemStatus,
  ThreadItemType,
  ThreadStepKind,
  ThreadStepStatus,
  ThreadStreamChunkType,
  ThreadThreadStatus,
} from "./thread.contract.js"
import { isThreadStreamChunkType } from "./thread.contract.js"

type IsoDateString = string

type ThreadStreamEventBase = {
  type: string
  at: IsoDateString
}

export type ContextCreatedEvent = ThreadStreamEventBase & {
  type: "context.created"
  contextId: string
  threadId: string
  status: ThreadContextStatus
}

export type ContextResolvedEvent = ThreadStreamEventBase & {
  type: "context.resolved"
  contextId: string
  threadId: string
  status: ThreadContextStatus
}

export type ContextOpenedEvent = ThreadStreamEventBase & {
  type: "context.opened"
  contextId: string
  threadId: string
  status: "open"
}

export type ContextClosedEvent = ThreadStreamEventBase & {
  type: "context.closed"
  contextId: string
  threadId: string
  status: "closed"
}

export type ContextContentUpdatedEvent = ThreadStreamEventBase & {
  type: "context.content_updated"
  contextId: string
  threadId: string
}

export type ThreadCreatedEvent = ThreadStreamEventBase & {
  type: "thread.created"
  threadId: string
  status: ThreadThreadStatus
}

export type ThreadResolvedEvent = ThreadStreamEventBase & {
  type: "thread.resolved"
  threadId: string
  status: ThreadThreadStatus
}

export type ThreadStreamingStartedEvent = ThreadStreamEventBase & {
  type: "thread.streaming_started"
  threadId: string
  status: "streaming"
}

export type ThreadIdleEvent = ThreadStreamEventBase & {
  type: "thread.idle"
  threadId: string
  status: "idle"
}

export type ExecutionCreatedEvent = ThreadStreamEventBase & {
  type: "execution.created"
  executionId: string
  contextId: string
  threadId: string
  status: "executing"
}

export type ExecutionCompletedEvent = ThreadStreamEventBase & {
  type: "execution.completed"
  executionId: string
  contextId: string
  threadId: string
  status: "completed"
}

export type ExecutionFailedEvent = ThreadStreamEventBase & {
  type: "execution.failed"
  executionId: string
  contextId: string
  threadId: string
  status: "failed"
}

export type ItemCreatedEvent = ThreadStreamEventBase & {
  type: "item.created"
  itemId: string
  contextId: string
  threadId: string
  executionId?: string
  status: ThreadItemStatus
  itemType?: ThreadItemType
}

export type ItemUpdatedEvent = ThreadStreamEventBase & {
  type: "item.updated"
  itemId: string
  contextId: string
  threadId: string
  executionId?: string
  status?: ThreadItemStatus
}

export type ItemPendingEvent = ThreadStreamEventBase & {
  type: "item.pending"
  itemId: string
  contextId: string
  threadId: string
  executionId?: string
  status: "pending"
}

export type ItemCompletedEvent = ThreadStreamEventBase & {
  type: "item.completed"
  itemId: string
  contextId: string
  threadId: string
  executionId?: string
  status: "completed"
}

export type StepCreatedEvent = ThreadStreamEventBase & {
  type: "step.created"
  stepId: string
  executionId: string
  iteration: number
  status: "running"
}

export type StepUpdatedEvent = ThreadStreamEventBase & {
  type: "step.updated"
  stepId: string
  executionId: string
  iteration?: number
  status?: ThreadStepStatus
  kind?: ThreadStepKind
  actionName?: string
}

export type StepCompletedEvent = ThreadStreamEventBase & {
  type: "step.completed"
  stepId: string
  executionId: string
  iteration?: number
  status: "completed"
}

export type StepFailedEvent = ThreadStreamEventBase & {
  type: "step.failed"
  stepId: string
  executionId: string
  iteration?: number
  status: "failed"
  errorText?: string
}

export type PartCreatedEvent = ThreadStreamEventBase & {
  type: "part.created"
  partKey: string
  stepId: string
  idx: number
  partType?: string
  partPreview?: string
  partState?: string
  partToolCallId?: string
}

export type PartUpdatedEvent = ThreadStreamEventBase & {
  type: "part.updated"
  partKey: string
  stepId: string
  idx: number
  partType?: string
  partPreview?: string
  partState?: string
  partToolCallId?: string
}

export type ChunkEmittedEvent = ThreadStreamEventBase & {
  type: "chunk.emitted"
  chunkType: ThreadStreamChunkType
  contextId: string
  executionId?: string
  stepId?: string
  itemId?: string
  partKey?: string
  actionRef?: string
  provider?: string
  providerChunkType?: string
  sequence: number
  data?: unknown
  raw?: unknown
}

export type ContextEvent =
  | ContextCreatedEvent
  | ContextResolvedEvent
  | ContextOpenedEvent
  | ContextClosedEvent
  | ContextContentUpdatedEvent

export type ThreadEvent =
  | ThreadCreatedEvent
  | ThreadResolvedEvent
  | ThreadStreamingStartedEvent
  | ThreadIdleEvent

export type ExecutionEvent =
  | ExecutionCreatedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent

export type ItemEvent =
  | ItemCreatedEvent
  | ItemUpdatedEvent
  | ItemPendingEvent
  | ItemCompletedEvent

export type StepEvent =
  | StepCreatedEvent
  | StepUpdatedEvent
  | StepCompletedEvent
  | StepFailedEvent

export type PartEvent = PartCreatedEvent | PartUpdatedEvent

export type ThreadStreamEvent =
  | ContextEvent
  | ThreadEvent
  | ExecutionEvent
  | ItemEvent
  | StepEvent
  | PartEvent
  | ChunkEmittedEvent

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
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
  if (value !== undefined) {
    assertString(value, label)
  }
}

function assertOptionalNumber(value: unknown, label: string) {
  if (value !== undefined) {
    assertNumber(value, label)
  }
}

export function parseThreadStreamEvent(value: unknown): ThreadStreamEvent {
  assertObject(value, "thread stream event")
  assertString(value.type, "thread stream event.type")
  assertString(value.at, "thread stream event.at")

  const type = value.type
  switch (type) {
    case "context.created":
    case "context.resolved": {
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as ContextCreatedEvent | ContextResolvedEvent
    }
    case "context.opened":
    case "context.closed": {
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as ContextOpenedEvent | ContextClosedEvent
    }
    case "context.content_updated": {
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      return value as ContextContentUpdatedEvent
    }
    case "thread.created":
    case "thread.resolved":
    case "thread.streaming_started":
    case "thread.idle": {
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as
        | ThreadCreatedEvent
        | ThreadResolvedEvent
        | ThreadStreamingStartedEvent
        | ThreadIdleEvent
    }
    case "execution.created":
    case "execution.completed":
    case "execution.failed": {
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as ExecutionCreatedEvent | ExecutionCompletedEvent | ExecutionFailedEvent
    }
    case "item.created": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.itemType, `${type}.itemType`)
      return value as ItemCreatedEvent
    }
    case "item.updated": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.status, `${type}.status`)
      return value as ItemUpdatedEvent
    }
    case "item.pending":
    case "item.completed": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertString(value.status, `${type}.status`)
      return value as ItemPendingEvent | ItemCompletedEvent
    }
    case "step.created": {
      assertString(value.stepId, `${type}.stepId`)
      assertString(value.executionId, `${type}.executionId`)
      assertNumber(value.iteration, `${type}.iteration`)
      assertString(value.status, `${type}.status`)
      return value as StepCreatedEvent
    }
    case "step.updated": {
      assertString(value.stepId, `${type}.stepId`)
      assertString(value.executionId, `${type}.executionId`)
      if (value.iteration !== undefined) assertNumber(value.iteration, `${type}.iteration`)
      assertOptionalString(value.status, `${type}.status`)
      assertOptionalString(value.kind, `${type}.kind`)
      assertOptionalString(value.actionName, `${type}.actionName`)
      return value as StepUpdatedEvent
    }
    case "step.completed":
    case "step.failed": {
      assertString(value.stepId, `${type}.stepId`)
      assertString(value.executionId, `${type}.executionId`)
      if (value.iteration !== undefined) assertNumber(value.iteration, `${type}.iteration`)
      assertString(value.status, `${type}.status`)
      if (type === "step.failed") assertOptionalString(value.errorText, `${type}.errorText`)
      return value as StepCompletedEvent | StepFailedEvent
    }
    case "part.created":
    case "part.updated": {
      assertString(value.partKey, `${type}.partKey`)
      assertString(value.stepId, `${type}.stepId`)
      assertNumber(value.idx, `${type}.idx`)
      assertOptionalString(value.partType, `${type}.partType`)
      assertOptionalString(value.partPreview, `${type}.partPreview`)
      assertOptionalString(value.partState, `${type}.partState`)
      assertOptionalString(value.partToolCallId, `${type}.partToolCallId`)
      return value as PartCreatedEvent | PartUpdatedEvent
    }
    case "chunk.emitted": {
      assertString(value.chunkType, `${type}.chunkType`)
      if (!isThreadStreamChunkType(value.chunkType)) {
        throw new Error(`Invalid ${type}.chunkType: ${String(value.chunkType)}`)
      }
      assertString(value.contextId, `${type}.contextId`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.stepId, `${type}.stepId`)
      assertOptionalString(value.itemId, `${type}.itemId`)
      assertOptionalString(value.partKey, `${type}.partKey`)
      assertOptionalString(value.actionRef, `${type}.actionRef`)
      assertOptionalString(value.provider, `${type}.provider`)
      assertOptionalString(value.providerChunkType, `${type}.providerChunkType`)
      assertOptionalNumber(value.sequence, `${type}.sequence`)
      return value as ChunkEmittedEvent
    }
    default:
      throw new Error(`Unsupported thread stream event type: ${type}`)
  }
}

export function assertThreadStreamTransitions(_event: ThreadStreamEvent) {
  return
}

export function validateThreadStreamTimeline(events: readonly ThreadStreamEvent[]) {
  for (const event of events) {
    assertThreadStreamTransitions(event)
  }
}
