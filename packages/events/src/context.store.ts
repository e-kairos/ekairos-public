import type { ModelMessage } from "ai"
import type {
  ContextStatus,
  ExecutionStatus,
  StepStatus,
  StepKind,
  ItemStatus,
  ItemType,
  Channel,
} from "./context.contract.js"

export type ContextIdentifier = { id: string; key?: never } | { key: string; id?: never }

export type { ContextStatus } from "./context.contract.js"

export type StoredContext<Context> = {
  id: string
  key: string | null
  name?: string | null
  status: ContextStatus
  createdAt: Date
  updatedAt?: Date
  content: Context | null
}

export type ContextItem = {
  id: string
  type: ItemType
  channel: Channel
  createdAt: string
  status?: ItemStatus
  content: {
    parts?: unknown[]
    [key: string]: unknown
  }
}

export type ContextStep = {
  id: string
  createdAt: Date
  updatedAt?: Date
  status: StepStatus
  iteration: number
  kind?: StepKind
  actionName?: string
  actionInput?: unknown
  actionOutput?: unknown
  actionError?: string
  actionRequests?: any
  actionResults?: any
  continueLoop?: boolean
  errorText?: string
}

export type ContextExecution = {
  id: string
  status: ExecutionStatus
}

export interface ContextStore {
  getOrCreateContext<C>(contextIdentifier: ContextIdentifier | null): Promise<StoredContext<C>>
  getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C> | null>
  updateContextContent<C>(contextIdentifier: ContextIdentifier, content: C): Promise<StoredContext<C>>
  updateContextStatus(contextIdentifier: ContextIdentifier, status: ContextStatus): Promise<void>

  saveItem(contextIdentifier: ContextIdentifier, item: ContextItem): Promise<ContextItem>
  updateItem(itemId: string, item: ContextItem): Promise<ContextItem>
  getItem(itemId: string): Promise<ContextItem | null>
  getItems(contextIdentifier: ContextIdentifier): Promise<ContextItem[]>

  createExecution(
    contextIdentifier: ContextIdentifier,
    triggerEventId: string,
    reactionEventId: string,
  ): Promise<{ id: string }>

  completeExecution(
    contextIdentifier: ContextIdentifier,
    executionId: string,
    status: Exclude<ExecutionStatus, "executing">,
  ): Promise<void>

  createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string }>

  updateStep(
    stepId: string,
    patch: Partial<
      Pick<
        ContextStep,
        | "status"
        | "kind"
        | "actionName"
        | "actionInput"
        | "actionOutput"
        | "actionError"
        | "actionRequests"
        | "actionResults"
        | "continueLoop"
        | "errorText"
        | "updatedAt"
      >
    >,
  ): Promise<void>

  saveStepParts(params: { stepId: string; parts: any[] }): Promise<void>

  linkItemToExecution(params: { itemId: string; executionId: string }): Promise<void>

  itemsToModelMessages(items: ContextItem[]): Promise<ModelMessage[]>
}
