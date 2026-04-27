import type {
  ContextStatus,
  ExecutionStatus,
  ItemStatus,
  ItemType,
  StepKind,
  StepStatus,
  ContextStreamChunkType,
} from "./context.contract.js"
import { isContextStreamChunkType } from "./context.contract.js"
import { assertValidContextPartChunkIdentity } from "./context.part-identity.js"

type IsoDateString = string

type ContextStreamEventBase = {
  type: string
  at: IsoDateString
}

export type ContextCreatedEvent = ContextStreamEventBase & {
  type: "context.created"
  contextId: string
  status: ContextStatus
}

export type ContextResolvedEvent = ContextStreamEventBase & {
  type: "context.resolved"
  contextId: string
  status: ContextStatus
}

export type ContextStatusChangedEvent = ContextStreamEventBase & {
  type: "context.status_changed"
  contextId: string
  status: ContextStatus
}

export type ContextContentUpdatedEvent = ContextStreamEventBase & {
  type: "context.content_updated"
  contextId: string
}

export type ExecutionCreatedEvent = ContextStreamEventBase & {
  type: "execution.created"
  executionId: string
  contextId: string
  status: Extract<ExecutionStatus, "executing">
}

export type ExecutionCompletedEvent = ContextStreamEventBase & {
  type: "execution.completed"
  executionId: string
  contextId: string
  status: Extract<ExecutionStatus, "completed">
}

export type ExecutionFailedEvent = ContextStreamEventBase & {
  type: "execution.failed"
  executionId: string
  contextId: string
  status: Extract<ExecutionStatus, "failed">
}

export type ItemCreatedEvent = ContextStreamEventBase & {
  type: "item.created"
  itemId: string
  contextId: string
  executionId?: string
  status: ItemStatus
  itemType?: ItemType
}

export type ItemUpdatedEvent = ContextStreamEventBase & {
  type: "item.updated"
  itemId: string
  contextId: string
  executionId?: string
  status?: ItemStatus
}

export type ItemPendingEvent = ContextStreamEventBase & {
  type: "item.pending"
  itemId: string
  contextId: string
  executionId?: string
  status: "pending"
}

export type ItemCompletedEvent = ContextStreamEventBase & {
  type: "item.completed"
  itemId: string
  contextId: string
  executionId?: string
  status: "completed"
}

export type StepCreatedEvent = ContextStreamEventBase & {
  type: "step.created"
  stepId: string
  executionId: string
  iteration: number
  status: "running"
}

export type StepUpdatedEvent = ContextStreamEventBase & {
  type: "step.updated"
  stepId: string
  executionId: string
  iteration?: number
  status?: StepStatus
  kind?: StepKind
  actionName?: string
}

export type StepCompletedEvent = ContextStreamEventBase & {
  type: "step.completed"
  stepId: string
  executionId: string
  iteration?: number
  status: "completed"
}

export type StepFailedEvent = ContextStreamEventBase & {
  type: "step.failed"
  stepId: string
  executionId: string
  iteration?: number
  status: "failed"
  errorText?: string
}

export type PartCreatedEvent = ContextStreamEventBase & {
  type: "part.created"
  partKey: string
  stepId: string
  idx: number
  partType?: string
  partPreview?: string
  partState?: string
  partToolCallId?: string
}

export type PartUpdatedEvent = ContextStreamEventBase & {
  type: "part.updated"
  partKey: string
  stepId: string
  idx: number
  partType?: string
  partPreview?: string
  partState?: string
  partToolCallId?: string
}

export type ChunkEmittedEvent = ContextStreamEventBase & {
  type: "chunk.emitted"
  chunkType: ContextStreamChunkType
  contextId: string
  executionId?: string
  stepId?: string
  itemId?: string
  partKey?: string
  partId?: string
  providerPartId?: string
  partType?: string
  partSlot?: string
  actionRef?: string
  provider?: string
  providerChunkType?: string
  sequence: number
  data?: unknown
  raw?: unknown
}

export type ContextLifecycleEvent =
  | ContextCreatedEvent
  | ContextResolvedEvent
  | ContextStatusChangedEvent
  | ContextContentUpdatedEvent

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

export type ContextStreamEvent =
  | ContextLifecycleEvent
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

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assertNumber(value, label)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: expected positive integer.`)
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

export function parseContextStreamEvent(value: unknown): ContextStreamEvent {
  assertObject(value, "context stream event")
  assertString(value.type, "context stream event.type")
  assertString(value.at, "context stream event.at")

  const type = value.type
  switch (type) {
    case "context.created":
    case "context.resolved":
    case "context.status_changed": {
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.status, `${type}.status`)
      return value as ContextCreatedEvent | ContextResolvedEvent | ContextStatusChangedEvent
    }
    case "context.content_updated": {
      assertString(value.contextId, `${type}.contextId`)
      return value as ContextContentUpdatedEvent
    }
    case "execution.created":
    case "execution.completed":
    case "execution.failed": {
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.status, `${type}.status`)
      return value as ExecutionCreatedEvent | ExecutionCompletedEvent | ExecutionFailedEvent
    }
    case "item.created": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.status, `${type}.status`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.itemType, `${type}.itemType`)
      return value as ItemCreatedEvent
    }
    case "item.updated": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.status, `${type}.status`)
      return value as ItemUpdatedEvent
    }
    case "item.pending":
    case "item.completed": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
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
      if (!isContextStreamChunkType(value.chunkType)) {
        throw new Error(`Invalid ${type}.chunkType: ${String(value.chunkType)}`)
      }
      assertString(value.contextId, `${type}.contextId`)
      assertOptionalString(value.executionId, `${type}.executionId`)
      assertOptionalString(value.stepId, `${type}.stepId`)
      assertOptionalString(value.itemId, `${type}.itemId`)
      assertOptionalString(value.partKey, `${type}.partKey`)
      assertOptionalString(value.partId, `${type}.partId`)
      assertOptionalString(value.providerPartId, `${type}.providerPartId`)
      assertOptionalString(value.partType, `${type}.partType`)
      assertOptionalString(value.partSlot, `${type}.partSlot`)
      assertOptionalString(value.actionRef, `${type}.actionRef`)
      assertOptionalString(value.provider, `${type}.provider`)
      assertOptionalString(value.providerChunkType, `${type}.providerChunkType`)
      assertPositiveInteger(value.sequence, `${type}.sequence`)
      assertValidContextPartChunkIdentity({
        label: type,
        chunkType: value.chunkType,
        stepId: typeof value.stepId === "string" ? value.stepId : undefined,
        partId: typeof value.partId === "string" ? value.partId : undefined,
        provider: typeof value.provider === "string" ? value.provider : undefined,
        providerPartId:
          typeof value.providerPartId === "string" ? value.providerPartId : undefined,
        partType: typeof value.partType === "string" ? value.partType : undefined,
        partSlot: typeof value.partSlot === "string" ? value.partSlot : undefined,
        actionRef: typeof value.actionRef === "string" ? value.actionRef : undefined,
      })
      return value as ChunkEmittedEvent
    }
    default:
      throw new Error(`Unsupported context stream event type: ${type}`)
  }
}

export function assertContextStreamTransitions(_event: ContextStreamEvent) {
  return
}

export function validateContextStreamTimeline(events: readonly ContextStreamEvent[]) {
  for (const event of events) {
    assertContextStreamTransitions(event)
  }
}
