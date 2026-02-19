import {
  assertContextTransition,
  assertExecutionTransition,
  assertItemTransition,
  assertStepTransition,
  assertThreadTransition,
  type ThreadContextStatus,
  type ThreadExecutionStatus,
  type ThreadItemStatus,
  type ThreadStepStatus,
  type ThreadStreamChunkType,
  type ThreadThreadStatus,
} from "./thread.contract.js"

type IsoDateString = string

type ThreadStreamEventBase = {
  type: string
  at: IsoDateString
}

// Hierarchy block 1: context
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

export type ContextStatusChangedEvent = ThreadStreamEventBase & {
  type: "context.status.changed"
  contextId: string
  threadId: string
  from: ThreadContextStatus
  to: ThreadContextStatus
}

// Hierarchy block 2: thread (execution belongs to thread lifecycle)
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

export type ThreadStatusChangedEvent = ThreadStreamEventBase & {
  type: "thread.status.changed"
  threadId: string
  from: ThreadThreadStatus
  to: ThreadThreadStatus
}

export type ExecutionCreatedEvent = ThreadStreamEventBase & {
  type: "execution.created"
  executionId: string
  contextId: string
  threadId: string
  status: ThreadExecutionStatus
}

export type ExecutionStatusChangedEvent = ThreadStreamEventBase & {
  type: "execution.status.changed"
  executionId: string
  contextId: string
  threadId: string
  from: ThreadExecutionStatus
  to: ThreadExecutionStatus
}

export type ThreadFinishedEvent = ThreadStreamEventBase & {
  type: "thread.finished"
  threadId: string
  contextId: string
  executionId: string
  result: "completed" | "failed"
}

// Hierarchy block 3: item
export type ItemCreatedEvent = ThreadStreamEventBase & {
  type: "item.created"
  itemId: string
  contextId: string
  threadId: string
  executionId?: string
  status: ThreadItemStatus
}

export type ItemStatusChangedEvent = ThreadStreamEventBase & {
  type: "item.status.changed"
  itemId: string
  executionId?: string
  from: ThreadItemStatus
  to: ThreadItemStatus
}

// Hierarchy block 4: step
export type StepCreatedEvent = ThreadStreamEventBase & {
  type: "step.created"
  stepId: string
  executionId: string
  iteration: number
  status: ThreadStepStatus
}

export type StepStatusChangedEvent = ThreadStreamEventBase & {
  type: "step.status.changed"
  stepId: string
  executionId: string
  from: ThreadStepStatus
  to: ThreadStepStatus
}

// Hierarchy block 5: part
export type PartCreatedEvent = ThreadStreamEventBase & {
  type: "part.created"
  partKey: string
  stepId: string
  idx: number
  part?: unknown
}

export type PartUpdatedEvent = ThreadStreamEventBase & {
  type: "part.updated"
  partKey: string
  stepId: string
  idx: number
  part?: unknown
}

// Hierarchy block 6: chunk
export type ChunkEmittedEvent = ThreadStreamEventBase & {
  type: "chunk.emitted"
  chunkType: ThreadStreamChunkType
  contextId: string
  executionId?: string
  stepId?: string
  data?: unknown
}

export type ThreadStreamEvent =
  | ContextCreatedEvent
  | ContextResolvedEvent
  | ContextStatusChangedEvent
  | ThreadCreatedEvent
  | ThreadResolvedEvent
  | ThreadStatusChangedEvent
  | ExecutionCreatedEvent
  | ExecutionStatusChangedEvent
  | ThreadFinishedEvent
  | ItemCreatedEvent
  | ItemStatusChangedEvent
  | StepCreatedEvent
  | StepStatusChangedEvent
  | PartCreatedEvent
  | PartUpdatedEvent
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
    case "context.status.changed": {
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.from, `${type}.from`)
      assertString(value.to, `${type}.to`)
      return value as ContextStatusChangedEvent
    }
    case "thread.created":
    case "thread.resolved": {
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as ThreadCreatedEvent | ThreadResolvedEvent
    }
    case "thread.status.changed": {
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.from, `${type}.from`)
      assertString(value.to, `${type}.to`)
      return value as ThreadStatusChangedEvent
    }
    case "execution.created": {
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      return value as ExecutionCreatedEvent
    }
    case "execution.status.changed": {
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.from, `${type}.from`)
      assertString(value.to, `${type}.to`)
      return value as ExecutionStatusChangedEvent
    }
    case "thread.finished": {
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.result, `${type}.result`)
      return value as ThreadFinishedEvent
    }
    case "item.created": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.contextId, `${type}.contextId`)
      assertString(value.threadId, `${type}.threadId`)
      assertString(value.status, `${type}.status`)
      if (value.executionId !== undefined) {
        assertString(value.executionId, `${type}.executionId`)
      }
      return value as ItemCreatedEvent
    }
    case "item.status.changed": {
      assertString(value.itemId, `${type}.itemId`)
      assertString(value.from, `${type}.from`)
      assertString(value.to, `${type}.to`)
      if (value.executionId !== undefined) {
        assertString(value.executionId, `${type}.executionId`)
      }
      return value as ItemStatusChangedEvent
    }
    case "step.created": {
      assertString(value.stepId, `${type}.stepId`)
      assertString(value.executionId, `${type}.executionId`)
      assertNumber(value.iteration, `${type}.iteration`)
      assertString(value.status, `${type}.status`)
      return value as StepCreatedEvent
    }
    case "step.status.changed": {
      assertString(value.stepId, `${type}.stepId`)
      assertString(value.executionId, `${type}.executionId`)
      assertString(value.from, `${type}.from`)
      assertString(value.to, `${type}.to`)
      return value as StepStatusChangedEvent
    }
    case "part.created":
    case "part.updated": {
      assertString(value.partKey, `${type}.partKey`)
      assertString(value.stepId, `${type}.stepId`)
      assertNumber(value.idx, `${type}.idx`)
      return value as PartCreatedEvent | PartUpdatedEvent
    }
    case "chunk.emitted": {
      assertString(value.chunkType, `${type}.chunkType`)
      assertString(value.contextId, `${type}.contextId`)
      if (value.executionId !== undefined) {
        assertString(value.executionId, `${type}.executionId`)
      }
      if (value.stepId !== undefined) {
        assertString(value.stepId, `${type}.stepId`)
      }
      return value as ChunkEmittedEvent
    }
    default: {
      throw new Error(`Unsupported thread stream event type: ${type}`)
    }
  }
}

export function assertThreadStreamTransitions(event: ThreadStreamEvent) {
  switch (event.type) {
    case "context.status.changed":
      assertContextTransition(event.from, event.to)
      return
    case "thread.status.changed":
      assertThreadTransition(event.from, event.to)
      return
    case "execution.status.changed":
      assertExecutionTransition(event.from, event.to)
      return
    case "item.status.changed":
      assertItemTransition(event.from, event.to)
      return
    case "step.status.changed":
      assertStepTransition(event.from, event.to)
      return
    default:
      return
  }
}

export function validateThreadStreamTimeline(events: readonly ThreadStreamEvent[]) {
  for (const event of events) {
    assertThreadStreamTransitions(event)
  }
}
