import type { ModelMessage } from "ai"
import type {
  ThreadThreadStatus,
  ThreadContextStatus,
  ThreadExecutionStatus,
  ThreadStepStatus as ContractThreadStepStatus,
  ThreadItemStatus,
  ThreadItemType,
  ThreadChannel,
} from "./thread.contract.js"

/**
 * ## thread.store.ts
 *
 * A `ThreadStore` is the persistence boundary for threads.
 *
 * Workflow DevKit constraints mean **workflows must be deterministic** and all I/O must happen
 * in steps. This library therefore models persistence as a pluggable store that can be
 * instantiated *inside steps* (InstantDB, Postgres, etc.).
 *
 * The core engine should depend only on this interface (not on a specific database).
 */

export type ThreadIdentifier = { id: string; key?: never } | { key: string; id?: never }
export type ContextIdentifier = ThreadIdentifier

export type ThreadStatus = ThreadThreadStatus

export type ContextStatus = ThreadContextStatus

export type StoredThread = {
  id: string
  key: string | null
  name?: string | null
  status: ThreadStatus
  createdAt: Date
  updatedAt?: Date
}

export type StoredContext<Context> = {
  id: string
  threadId?: string
  key: string | null
  status: ContextStatus
  createdAt: Date
  updatedAt?: Date
  content: Context | null
}

export type ThreadItem = {
  id: string
  type: ThreadItemType
  channel: ThreadChannel
  createdAt: string
  status?: ThreadItemStatus
  content: {
    parts?: unknown[]
    [key: string]: unknown
  }
}

export type ExecutionStatus = ThreadExecutionStatus

export type ThreadStepStatus = ContractThreadStepStatus

export type ThreadStep = {
  id: string
  createdAt: Date
  updatedAt?: Date
  status: ThreadStepStatus
  iteration: number
  executionId: string
  triggerEventId?: string
  reactionEventId?: string
  eventId: string
  toolCalls?: any
  toolExecutionResults?: any
  continueLoop?: boolean
  errorText?: string
}

export interface ThreadStore {
  getOrCreateThread(threadIdentifier: ThreadIdentifier | null): Promise<StoredThread>
  getThread(threadIdentifier: ThreadIdentifier): Promise<StoredThread | null>
  updateThreadStatus(threadIdentifier: ThreadIdentifier, status: ThreadStatus): Promise<void>

  getOrCreateContext<C>(contextIdentifier: ContextIdentifier | null): Promise<StoredContext<C>>
  getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C> | null>
  updateContextContent<C>(contextIdentifier: ContextIdentifier, content: C): Promise<StoredContext<C>>
  updateContextStatus(contextIdentifier: ContextIdentifier, status: ContextStatus): Promise<void>

  saveItem(contextIdentifier: ContextIdentifier, item: ThreadItem): Promise<ThreadItem>
  updateItem(itemId: string, item: ThreadItem): Promise<ThreadItem>
  getItem(itemId: string): Promise<ThreadItem | null>
  getItems(contextIdentifier: ContextIdentifier): Promise<ThreadItem[]>

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

  /**
   * Creates a persisted thread step (intended: one per loop iteration).
   *
   * IMPORTANT: IDs should be generated inside the store boundary (step runtime) to remain replay-safe.
   */
  createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string; eventId: string }>

  /**
   * Updates a persisted thread step with completion metadata (tools, errors, continue signal, etc).
   */
  updateStep(
    stepId: string,
    patch: Partial<
      Pick<
        ThreadStep,
        | "status"
        | "toolCalls"
        | "toolExecutionResults"
        | "continueLoop"
        | "errorText"
        | "updatedAt"
      >
    >,
  ): Promise<void>

  /**
   * Persists normalized parts for a given step (parts-first).
   * The item keeps `content.parts` for back-compat, but the source-of-truth can be `thread_parts`.
   */
  saveStepParts(params: { stepId: string; parts: any[] }): Promise<void>

  /**
   * Links an event to an execution so consumers can traverse:
   * `event -> execution -> steps`
   */
  linkItemToExecution(params: { itemId: string; executionId: string }): Promise<void>

  /**
   * Converts items to model messages for the next LLM call.
   *
   * NOTE:
   * - Attachment/document expansion should happen earlier in the Thread loop via `expandEvents(...)`.
   * - This method should stay focused on converting already-normalized event parts into `ModelMessage[]`.
   */
  itemsToModelMessages(items: ThreadItem[]): Promise<ModelMessage[]>
}



