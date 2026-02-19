export type Transition<From extends string, To extends string> = {
  from: From
  to: To
}

export const THREAD_STATUSES = ["open", "streaming", "closed", "failed"] as const
export type ThreadThreadStatus = (typeof THREAD_STATUSES)[number]

export const THREAD_CONTEXT_STATUSES = ["open", "streaming", "closed"] as const
export type ThreadContextStatus = (typeof THREAD_CONTEXT_STATUSES)[number]

export const THREAD_EXECUTION_STATUSES = ["executing", "completed", "failed"] as const
export type ThreadExecutionStatus = (typeof THREAD_EXECUTION_STATUSES)[number]

export const THREAD_STEP_STATUSES = ["running", "completed", "failed"] as const
export type ThreadStepStatus = (typeof THREAD_STEP_STATUSES)[number]

export const THREAD_ITEM_STATUSES = ["stored", "pending", "completed"] as const
export type ThreadItemStatus = (typeof THREAD_ITEM_STATUSES)[number]

export const THREAD_ITEM_TYPES = ["input_text", "output_text", "ekairos:system"] as const
export type ThreadItemType = (typeof THREAD_ITEM_TYPES)[number]

export const THREAD_CHANNELS = ["web", "whatsapp", "email"] as const
export type ThreadChannel = (typeof THREAD_CHANNELS)[number]

export const THREAD_TRACE_EVENT_KINDS = [
  "workflow.run",
  "workflow.step",
  "thread.run",
  "thread.context",
  "thread.execution",
  "thread.item",
  "thread.review",
  "thread.step",
  "thread.part",
  "thread.llm",
] as const
export type ThreadTraceEventKind = (typeof THREAD_TRACE_EVENT_KINDS)[number]

export const THREAD_STREAM_CHUNK_TYPES = [
  "data-context-id",
  "data-context-substate",
  "data-thread-ping",
  "tool-output-available",
  "tool-output-error",
  "finish",
] as const
export type ThreadStreamChunkType = (typeof THREAD_STREAM_CHUNK_TYPES)[number]

export const THREAD_CONTEXT_SUBSTATE_KEYS = ["actions"] as const
export type ThreadContextSubstateKey = (typeof THREAD_CONTEXT_SUBSTATE_KEYS)[number]

export type ThreadTransition = Transition<"open" | "streaming" | "failed", "open" | "streaming" | "closed" | "failed">
export type ContextTransition = Transition<"open" | "streaming", "streaming" | "open" | "closed">
export type ExecutionTransition = Transition<"executing", "completed" | "failed">
export type StepTransition = Transition<"running", "completed" | "failed">
export type ItemTransition = Transition<"stored" | "pending", "pending" | "completed">

export const THREAD_THREAD_TRANSITIONS: readonly ThreadTransition[] = [
  { from: "open", to: "streaming" },
  { from: "streaming", to: "open" },
  { from: "streaming", to: "closed" },
  { from: "streaming", to: "failed" },
  { from: "failed", to: "open" },
]

export const THREAD_CONTEXT_TRANSITIONS: readonly ContextTransition[] = [
  { from: "open", to: "streaming" },
  { from: "streaming", to: "open" },
  { from: "open", to: "closed" },
  { from: "streaming", to: "closed" },
]

export const THREAD_EXECUTION_TRANSITIONS: readonly ExecutionTransition[] = [
  { from: "executing", to: "completed" },
  { from: "executing", to: "failed" },
]

export const THREAD_STEP_TRANSITIONS: readonly StepTransition[] = [
  { from: "running", to: "completed" },
  { from: "running", to: "failed" },
]

export const THREAD_ITEM_TRANSITIONS: readonly ItemTransition[] = [
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

export function canThreadTransition(from: string, to: string) {
  return canTransition(THREAD_THREAD_TRANSITIONS, from, to)
}

export function canContextTransition(from: string, to: string) {
  return canTransition(THREAD_CONTEXT_TRANSITIONS, from, to)
}

export function canExecutionTransition(from: string, to: string) {
  return canTransition(THREAD_EXECUTION_TRANSITIONS, from, to)
}

export function canStepTransition(from: string, to: string) {
  return canTransition(THREAD_STEP_TRANSITIONS, from, to)
}

export function canItemTransition(from: string, to: string) {
  return canTransition(THREAD_ITEM_TRANSITIONS, from, to)
}

export function assertThreadTransition(from: string, to: string) {
  assertTransition(THREAD_THREAD_TRANSITIONS, from, to, "thread.status")
}

export function assertContextTransition(from: string, to: string) {
  assertTransition(THREAD_CONTEXT_TRANSITIONS, from, to, "context.status")
}

export function assertExecutionTransition(from: string, to: string) {
  assertTransition(THREAD_EXECUTION_TRANSITIONS, from, to, "execution.status")
}

export function assertStepTransition(from: string, to: string) {
  assertTransition(THREAD_STEP_TRANSITIONS, from, to, "step.status")
}

export function assertItemTransition(from: string, to: string) {
  assertTransition(THREAD_ITEM_TRANSITIONS, from, to, "item.status")
}

export function assertThreadPartKey(stepId: string, idx: number, key: string) {
  const expected = `${stepId}:${idx}`
  if (key !== expected) {
    throw new Error(`Invalid thread_parts.key: expected "${expected}" got "${key}"`)
  }
}

