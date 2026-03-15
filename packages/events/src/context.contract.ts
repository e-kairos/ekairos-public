export type Transition<From extends string, To extends string> = {
  from: From
  to: To
}

export const CONTEXT_STATUSES = ["open_idle", "open_streaming", "closed"] as const
export type ContextStatus = (typeof CONTEXT_STATUSES)[number]

export const EXECUTION_STATUSES = ["executing", "completed", "failed"] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export const STEP_STATUSES = ["running", "completed", "failed"] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export const STEP_KINDS = [
  "message",
  "action_execute",
  "action_result",
] as const
export type StepKind = (typeof STEP_KINDS)[number]

export const ITEM_STATUSES = ["stored", "pending", "completed"] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const ITEM_TYPES = [
  "input",
  "output",
] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const CHANNELS = ["web", "whatsapp", "email"] as const
export type Channel = (typeof CHANNELS)[number]

export const TRACE_EVENT_KINDS = [
  "workflow.run",
  "workflow.step",
  "context.run",
  "context.lifecycle",
  "context.execution",
  "context.item",
  "context.review",
  "context.step",
  "context.part",
  "context.llm",
] as const
export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number]

export const STREAM_LIFECYCLE_CHUNK_TYPES = [
  "chunk.start",
  "chunk.start_step",
  "chunk.finish_step",
  "chunk.finish",
] as const

export const STREAM_TEXT_CHUNK_TYPES = [
  "chunk.text_start",
  "chunk.text_delta",
  "chunk.text_end",
] as const

export const STREAM_REASONING_CHUNK_TYPES = [
  "chunk.reasoning_start",
  "chunk.reasoning_delta",
  "chunk.reasoning_end",
] as const

export const STREAM_ACTION_CHUNK_TYPES = [
  "chunk.action_input_start",
  "chunk.action_input_delta",
  "chunk.action_input_available",
  "chunk.action_output_available",
  "chunk.action_output_error",
] as const

export const STREAM_SOURCE_CHUNK_TYPES = [
  "chunk.source_url",
  "chunk.source_document",
  "chunk.file",
] as const

export const STREAM_METADATA_CHUNK_TYPES = [
  "chunk.message_metadata",
  "chunk.response_metadata",
] as const

export const STREAM_ERROR_CHUNK_TYPES = [
  "chunk.error",
  "chunk.unknown",
] as const

export const CONTEXT_STREAM_CHUNK_TYPES = [
  ...STREAM_LIFECYCLE_CHUNK_TYPES,
  ...STREAM_TEXT_CHUNK_TYPES,
  ...STREAM_REASONING_CHUNK_TYPES,
  ...STREAM_ACTION_CHUNK_TYPES,
  ...STREAM_SOURCE_CHUNK_TYPES,
  ...STREAM_METADATA_CHUNK_TYPES,
  ...STREAM_ERROR_CHUNK_TYPES,
] as const
export type ContextStreamChunkType = (typeof CONTEXT_STREAM_CHUNK_TYPES)[number]

export function isContextStreamChunkType(value: string): value is ContextStreamChunkType {
  return (CONTEXT_STREAM_CHUNK_TYPES as readonly string[]).includes(value)
}

export type ContextTransition = Transition<
  "open_idle" | "open_streaming" | "closed",
  "open_idle" | "open_streaming" | "closed"
>
export type ExecutionTransition = Transition<"executing", "completed" | "failed">
export type StepTransition = Transition<"running", "completed" | "failed">
export type ItemTransition = Transition<"stored" | "pending", "pending" | "completed">

export const CONTEXT_TRANSITIONS: readonly ContextTransition[] = [
  { from: "open_idle", to: "open_streaming" },
  { from: "open_streaming", to: "open_idle" },
  { from: "open_idle", to: "closed" },
  { from: "open_streaming", to: "closed" },
  { from: "closed", to: "open_idle" },
]

export const EXECUTION_TRANSITIONS: readonly ExecutionTransition[] = [
  { from: "executing", to: "completed" },
  { from: "executing", to: "failed" },
]

export const STEP_TRANSITIONS: readonly StepTransition[] = [
  { from: "running", to: "completed" },
  { from: "running", to: "failed" },
]

export const ITEM_TRANSITIONS: readonly ItemTransition[] = [
  { from: "stored", to: "pending" },
  { from: "stored", to: "completed" },
  { from: "pending", to: "completed" },
]

function canTransition<From extends string, To extends string>(
  transitions: readonly Transition<From, To>[],
  from: string,
  to: string,
) {
  return transitions.some((transition) => transition.from === from && transition.to === to)
}

function assertTransition<From extends string, To extends string>(
  transitions: readonly Transition<From, To>[],
  from: string,
  to: string,
  entity: string,
) {
  if (!canTransition(transitions, from, to)) {
    throw new Error(`Invalid ${entity} transition: ${from} -> ${to}`)
  }
}

export function canContextTransition(from: string, to: string) {
  return canTransition(CONTEXT_TRANSITIONS, from, to)
}

export function canExecutionTransition(from: string, to: string) {
  return canTransition(EXECUTION_TRANSITIONS, from, to)
}

export function canStepTransition(from: string, to: string) {
  return canTransition(STEP_TRANSITIONS, from, to)
}

export function canItemTransition(from: string, to: string) {
  return canTransition(ITEM_TRANSITIONS, from, to)
}

export function assertContextTransition(from: string, to: string) {
  assertTransition(CONTEXT_TRANSITIONS, from, to, "context.status")
}

export function assertExecutionTransition(from: string, to: string) {
  assertTransition(EXECUTION_TRANSITIONS, from, to, "execution.status")
}

export function assertStepTransition(from: string, to: string) {
  assertTransition(STEP_TRANSITIONS, from, to, "step.status")
}

export function assertItemTransition(from: string, to: string) {
  assertTransition(ITEM_TRANSITIONS, from, to, "item.status")
}

export function assertContextPartKey(stepId: string, idx: number, key: string) {
  const expected = `${stepId}:${idx}`
  if (key !== expected) {
    throw new Error(`Invalid context_parts.key: expected "${expected}" got "${key}"`)
  }
}
