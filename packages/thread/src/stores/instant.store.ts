import "../polyfills/dom-events.js"
import { id, lookup } from "@instantdb/admin"

import { threadDomain } from "../schema.js"
import type { DomainSchemaResult } from "@ekairos/domain";
import { convertItemsToModelMessages } from "../thread.events.js"
import {
  assertContextTransition,
  assertExecutionTransition,
  assertItemTransition,
  assertStepTransition,
  assertThreadTransition,
  type ThreadExecutionStatus as ExecutionStatus,
  type ThreadStepStatus,
} from "../thread.contract.js"
import type { ModelMessage } from "ai"
import type {
  ThreadItem,
  ContextIdentifier,
  ThreadIdentifier,
  ThreadStatus,
  ContextStatus,
  StoredThread,
  StoredContext,
  ThreadStore,
} from "../thread.store.js"
export { parseAndStoreDocument } from "./instant.document-parser.js"
import { expandEventsWithInstantDocuments } from "./instant.documents.js"
export {
  coerceDocumentTextPages,
  expandEventsWithInstantDocuments,
} from "./instant.documents.js"

/**
 * InstantDB-backed ThreadStore.
 *
 * This is intentionally kept behind the store boundary so the core story engine
 * can remain database-agnostic.
 */
export type InstantStoreDb = any

function shouldDebugInstantStore() {
  return (
    process.env.EKAIROS_THREAD_DEBUG === "1" ||
    process.env.PLAYWRIGHT_TEST === "1"
  )
}

function clipText(value: string, max = 500) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...<truncated:${value.length - max}>`
}

function simplifyForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return clipText(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= 2) return "[max-depth]"

  if (Array.isArray(value)) {
    const maxItems = 8
    const items = value
      .slice(0, maxItems)
      .map((item) => simplifyForLog(item, depth + 1))
    if (value.length > maxItems) {
      items.push(`...+${value.length - maxItems} more`)
    }
    return items
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    const maxEntries = 16
    const out: Record<string, unknown> = {}
    for (const [key, entryValue] of entries.slice(0, maxEntries)) {
      out[key] = simplifyForLog(entryValue, depth + 1)
    }
    if (entries.length > maxEntries) {
      out.__truncatedKeys = entries.length - maxEntries
    }
    return out
  }

  return String(value)
}

function summarizeError(error: unknown): Record<string, unknown> {
  const err = error as any
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    status: err?.status ?? err?.statusCode,
    details: simplifyForLog(
      err?.details ?? err?.body ?? err?.response ?? err?.data,
    ),
    stack:
      typeof err?.stack === "string"
        ? clipText(err.stack, 1500)
        : undefined,
  }
}

function logInstantTransactFailure(params: {
  action: string
  meta?: Record<string, unknown>
  txs: unknown[]
  error: unknown
}) {
  if (!shouldDebugInstantStore()) return

  const payload = {
    action: params.action,
    meta: simplifyForLog(params.meta ?? {}),
    txs: simplifyForLog(params.txs),
    error: summarizeError(params.error),
  }
  // eslint-disable-next-line no-console
  console.error("[thread][instant.store] transact failed", payload)
}

export class InstantStore implements ThreadStore {
  private db: any

  constructor(db: InstantStoreDb) {
    this.db = db
  }

  private async syncLegacyThreadRowBestEffort(threadId: string): Promise<void> {
    if (!threadId) return
    try {
      await this.db.transact([
        this.db.tx.thread[threadId].update({}),
      ])
    } catch {
      // Legacy `thread` entity does not exist on all apps.
      // This is a best-effort compatibility write.
    }
  }

  private async ensureContextThreadLink<C>(
    context: StoredContext<C>,
    contextIdentifier?: ContextIdentifier | null,
  ): Promise<StoredContext<C>> {
    if (context.threadId) return context

    const fallbackKey =
      contextIdentifier?.key ??
      context.key ??
      (context.id ? String(context.id) : null)
    const thread = await this.createThread(
      fallbackKey ? { key: String(fallbackKey) } : null,
      context.id ? String(context.id) : undefined,
    )
    await this.syncLegacyThreadRowBestEffort(thread.id)

    const txs: any[] = [this.db.tx.thread_contexts[context.id].link({ thread: thread.id })]
    if (!context.key && thread.key) {
      txs.push(
        this.db.tx.thread_contexts[context.id].update({
          key: thread.key,
          updatedAt: new Date(),
        }),
      )
    }

    await this.db.transact(txs)

    const refreshed = await this.getContext<C>({ id: context.id })
    if (refreshed) return refreshed

    return {
      ...context,
      threadId: thread.id,
      key: thread.key ?? context.key,
    }
  }

  private normalizeThread(row: any): StoredThread {
    return {
      id: String(row?.id ?? ""),
      key: typeof row?.key === "string" ? row.key : null,
      name: typeof row?.name === "string" ? row.name : null,
      status: (typeof row?.status === "string" ? row.status : "open") as ThreadStatus,
      createdAt: row?.createdAt instanceof Date ? row.createdAt : new Date(row?.createdAt ?? Date.now()),
      updatedAt: row?.updatedAt instanceof Date ? row.updatedAt : row?.updatedAt ? new Date(row.updatedAt) : undefined,
    }
  }

  private normalizeContext<C>(row: any, thread?: StoredThread | null): StoredContext<C> {
    return {
      id: String(row?.id ?? ""),
      threadId: thread?.id,
      key:
        (typeof row?.key === "string" && row.key.length > 0
          ? row.key
          : thread?.key ?? null),
      status: (typeof row?.status === "string" ? row.status : "open") as ContextStatus,
      createdAt: row?.createdAt instanceof Date ? row.createdAt : new Date(row?.createdAt ?? Date.now()),
      updatedAt: row?.updatedAt instanceof Date ? row.updatedAt : row?.updatedAt ? new Date(row.updatedAt) : undefined,
      content: (row?.content as C) ?? null,
    }
  }

  private async getThreadByContextId(contextId: string): Promise<StoredThread | null> {
    let contextKey: string | null = null
    try {
      const res = await this.db.query({
        thread_contexts: {
          $: { where: { id: contextId as any }, limit: 1 },
          thread: {},
        },
      })
      const ctx = (res?.thread_contexts as any[])?.[0]
      contextKey = typeof ctx?.key === "string" ? ctx.key : null
      const threadNode = Array.isArray(ctx?.thread) ? ctx.thread[0] : ctx?.thread
      if (threadNode) {
        const normalized = this.normalizeThread(threadNode)
        if (normalized.id) return normalized
      }
    } catch {
      // fallback below
    }

    if (contextKey) {
      try {
        const byKey = await this.getThread({ key: contextKey })
        if (byKey?.id) return byKey
      } catch {
        // continue fallback chain
      }
    }

    try {
      const res = await this.db.query({
        thread_threads: {
          $: { where: { "contexts.id": contextId }, limit: 1 },
        },
      })
      const row = (res?.thread_threads as any[])?.[0]
      return row ? this.normalizeThread(row) : null
    } catch {
      try {
        const executionFallback = await this.db.query({
          thread_executions: {
            $: { where: { "context.id": contextId }, limit: 1 },
            thread: {},
          },
        })
        const executionRow = (executionFallback?.thread_executions as any[])?.[0]
        const executionThread = Array.isArray(executionRow?.thread)
          ? executionRow.thread[0]
          : executionRow?.thread
        const normalized = executionThread ? this.normalizeThread(executionThread) : null
        return normalized?.id ? normalized : null
      } catch {
        return null
      }
    }
  }

  private async getContextByThreadId<C>(threadId: string): Promise<StoredContext<C> | null> {
    try {
      const res = await this.db.query({
        thread_contexts: {
          $: { where: { thread: threadId as any }, limit: 1 },
        },
      })
      const row = (res?.thread_contexts as any[])?.[0]
      if (!row) return null
      const thread = await this.getThread({ id: threadId })
      return this.normalizeContext<C>(row, thread)
    } catch {
      try {
        const res = await this.db.query({
          thread_contexts: {
            $: { where: { "thread.id": threadId }, limit: 1 },
          },
        })
        const row = (res?.thread_contexts as any[])?.[0]
        if (!row) return null
        const thread = await this.getThread({ id: threadId })
        return this.normalizeContext<C>(row, thread)
      } catch {
        return null
      }
    }
  }

  private async ensureContextKey<C>(
    context: StoredContext<C>,
    expectedKey?: string | null,
  ): Promise<StoredContext<C>> {
    if (!expectedKey) return context
    if (context.key === expectedKey) return context

    await this.db.transact([
      this.db.tx.thread_contexts[context.id].update({
        key: expectedKey,
        updatedAt: new Date(),
      }),
    ])

    const refreshed = await this.getContext<C>({ id: context.id })
    return refreshed ?? { ...context, key: expectedKey }
  }

  private async createThread(
    threadIdentifier: ThreadIdentifier | null,
    fallbackKey?: string,
  ): Promise<StoredThread> {
    const threadId = threadIdentifier?.id ?? id()
    const key =
      threadIdentifier?.key ??
      fallbackKey ??
      (threadIdentifier?.id ? String(threadIdentifier.id) : null)

    await this.db.transact([
      this.db.tx.thread_threads[threadId].create({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "open",
        key,
      }),
    ])
    await this.syncLegacyThreadRowBestEffort(threadId)

    const thread = await this.getThread({ id: threadId })
    if (!thread) {
      throw new Error("InstantStore: failed to create thread")
    }
    return thread
  }

  async getOrCreateThread(
    threadIdentifier: ThreadIdentifier | null,
  ): Promise<StoredThread> {
    if (!threadIdentifier) {
      return this.createThread(null)
    }

    const existing = await this.getThread(threadIdentifier)
    if (existing) return existing
    return this.createThread(threadIdentifier)
  }

  async getThread(threadIdentifier: ThreadIdentifier): Promise<StoredThread | null> {
    try {
      if (threadIdentifier.id) {
        const res = await this.db.query({
          thread_threads: {
            $: { where: { id: threadIdentifier.id as any }, limit: 1 },
          },
        })
        const row = (res?.thread_threads as any[])?.[0]
        return row ? this.normalizeThread(row) : null
      }

      const res = await this.db.query({
        thread_threads: {
          $: { where: { key: threadIdentifier.key }, limit: 1 },
        },
      })
      const row = (res?.thread_threads as any[])?.[0]
      return row ? this.normalizeThread(row) : null
    } catch (error: any) {
      throw new Error("InstantStore: Error getting thread: " + error.message)
    }
  }

  async updateThreadStatus(
    threadIdentifier: ThreadIdentifier,
    status: ThreadStatus,
  ): Promise<void> {
    const thread = await this.getThread(threadIdentifier)
    if (!thread) throw new Error("InstantStore: thread not found")
    if (thread.status !== status) {
      assertThreadTransition(thread.status, status)
    }
    await this.db.transact([
      this.db.tx.thread_threads[thread.id].update({
        status,
        updatedAt: new Date(),
      }),
    ])
  }

  async getOrCreateContext<C>(
    contextIdentifier: ContextIdentifier | null,
  ): Promise<StoredContext<C>> {
    if (!contextIdentifier) {
      const contextId = id()
      const thread = await this.createThread(null, contextId)
      return await this.createContextForThread<C>(thread, contextId)
    }

    const context = await this.getContext<C>(contextIdentifier)
    if (context) {
      const linked = await this.ensureContextThreadLink(context, contextIdentifier)
      if (contextIdentifier.key) {
        return await this.ensureContextKey(linked, contextIdentifier.key)
      }
      return linked
    }

    if (contextIdentifier.key) {
      const thread = await this.getOrCreateThread({ key: contextIdentifier.key })
      return await this.createContextForThread<C>(thread)
    }

    const thread = await this.getOrCreateThread(
      contextIdentifier.id ? { key: String(contextIdentifier.id) } : null,
    )
    return await this.createContextForThread<C>(thread, contextIdentifier.id)
  }

  private async createContextForThread<C>(
    thread: StoredThread,
    contextId?: string,
  ): Promise<StoredContext<C>> {
    const contextData: {
      createdAt: Date
      key?: string
      content: Record<string, unknown>
      status: "open"
    } = {
      createdAt: new Date(),
      key: thread.key ?? undefined,
      content: {},
      status: "open",
    }

    const newContextId = contextId ?? id()

    await this.db.transact([
      this.db.tx.thread_contexts[newContextId].create(contextData),
      this.db.tx.thread_contexts[newContextId].link({ thread: thread.id }),
    ])

    const ctx = await this.getContext<C>({ id: newContextId })
    if (!ctx) throw new Error("InstantStore: failed to create context")
    return ctx
  }

  async getContext<C>(
    contextIdentifier: ContextIdentifier,
  ): Promise<StoredContext<C> | null> {
    try {
      if (contextIdentifier.id) {
        const res = await this.db.query({
          thread_contexts: {
            $: { where: { id: contextIdentifier.id as any }, limit: 1 },
          },
        })
        const row = (res?.thread_contexts as any[])?.[0]
        if (!row) return null
        const thread = await this.getThreadByContextId(String(row.id))
        return this.normalizeContext<C>(row, thread)
      }

      if (contextIdentifier.key) {
        try {
          const byKey = await this.db.query({
            thread_contexts: {
              $: { where: { key: contextIdentifier.key }, limit: 1 },
            },
          })
          const row = (byKey?.thread_contexts as any[])?.[0]
          if (row) {
            const thread = await this.getThreadByContextId(String(row.id))
            return this.normalizeContext<C>(row, thread)
          }
        } catch {
          // Backward compatibility:
          // If remote schema has not been pushed yet and `thread_contexts.key` is absent,
          // fallback to resolving by thread key below.
        }

        const thread = await this.getThread({ key: contextIdentifier.key })
        if (!thread) return null
        const ctx = await this.getContextByThreadId<C>(thread.id)
        if (!ctx) return null
        return await this.ensureContextKey(ctx, contextIdentifier.key)
      }

      return null
    } catch (error: any) {
      throw new Error("InstantStore: Error getting context: " + error.message)
    }
  }

  async updateContextContent<C>(
    contextIdentifier: ContextIdentifier,
    content: C,
  ): Promise<StoredContext<C>> {
    const context = await this.getContext<C>(contextIdentifier)
    if (!context?.id) throw new Error("InstantStore: context not found")

    await this.db.transact([
      this.db.tx.thread_contexts[context.id].update({
        content: content as any,
        updatedAt: new Date(),
      }),
    ])

    const ctx = await this.getContext<C>(contextIdentifier)
    if (!ctx) throw new Error("InstantStore: context not found after update")
    return ctx
  }

  async updateContextStatus(
    contextIdentifier: ContextIdentifier,
    status: ContextStatus,
  ): Promise<void> {
    const context = await this.getContext(contextIdentifier)
    if (!context?.id) throw new Error("InstantStore: context not found")
    if (context.status !== status) {
      assertContextTransition(context.status, status)
    }

    const txs: any[] = [
      this.db.tx.thread_contexts[context.id].update({
        status,
        updatedAt: new Date(),
      }),
    ]
    if (context.threadId) {
      const thread = await this.getThread({ id: context.threadId })
      const nextThreadStatus = (status === "closed" ? "closed" : status) as ThreadStatus
      if (thread && thread.status !== nextThreadStatus) {
        assertThreadTransition(thread.status, nextThreadStatus)
      }
      txs.push(
        this.db.tx.thread_threads[context.threadId].update({
          status: nextThreadStatus,
          updatedAt: new Date(),
        }),
      )
    }
    await this.db.transact(txs)
  }

  private async resolveThreadContext<C>(contextIdentifier: ContextIdentifier): Promise<{
    context: StoredContext<C>
    thread: StoredThread
  }> {
    const context = await this.getContext<C>(contextIdentifier)
    if (!context?.id) throw new Error("InstantStore: context not found")
    let thread = context.threadId
      ? await this.getThread({ id: context.threadId })
      : await this.getThreadByContextId(context.id)
    if (!thread) {
      const healed = await this.ensureContextThreadLink(context, contextIdentifier)
      thread = healed.threadId ? await this.getThread({ id: healed.threadId }) : null
    }
    if (!thread) throw new Error("InstantStore: thread not found for context")
    return { context: { ...context, threadId: thread.id }, thread }
  }

  async saveItem(
    contextIdentifier: ContextIdentifier,
    event: ThreadItem,
  ): Promise<ThreadItem> {
    const { context, thread } = await this.resolveThreadContext(contextIdentifier)
    const existing = await this.getItem(event.id)
    if (existing?.status && existing.status !== "stored") {
      assertItemTransition(existing.status, "stored")
    }
    const txs = [
      this.db.tx.thread_items[event.id].update({
        ...(event as any),
        status: "stored",
      }),
    ]
    txs.push(this.db.tx.thread_items[event.id].link({ context: context.id }))
    txs.push(this.db.tx.thread_items[event.id].link({ thread: thread.id }))

    try {
      await this.db.transact(txs as any)
    } catch (error) {
      logInstantTransactFailure({
        action: "saveItem",
        meta: {
          contextIdentifier: simplifyForLog(contextIdentifier),
          contextId: context.id,
          threadId: thread.id,
          eventId: (event as any)?.id,
          eventType: (event as any)?.type,
          eventChannel: (event as any)?.channel,
          eventCreatedAt: (event as any)?.createdAt,
        },
        txs,
        error,
      })
      throw error
    }

    const persisted = await this.getItem(event.id)
    if (!persisted) throw new Error("InstantStore: failed to read event after save")
    return persisted
  }

  async updateItem(eventId: string, event: ThreadItem): Promise<ThreadItem> {
    const current = await this.getItem(eventId)
    if (current?.status && event.status && current.status !== event.status) {
      assertItemTransition(current.status, event.status)
    }
    await this.db.transact([this.db.tx.thread_items[eventId].update(event as any)])
    const persisted = await this.getItem(eventId)
    if (!persisted) throw new Error("InstantStore: event not found after update")
    return persisted
  }

  async getItem(eventId: string): Promise<ThreadItem | null> {
    const res = await this.db.query({
      thread_items: {
        $: { where: { id: eventId as any } },
      },
    })
    return (res.thread_items?.[0] as any) ?? null
  }

  async getItems(contextIdentifier: ContextIdentifier): Promise<ThreadItem[]> {
    const { thread } = await this.resolveThreadContext(contextIdentifier)
    let res: any
    try {
      res = await this.db.query({
        thread_items: {
          $: {
            where: { thread: thread.id as any },
            // Keep query constraints minimal to avoid hard dependency on Instant orderable indexes.
            // Ordering is applied in-memory below.
            limit: 1000,
          },
        },
      })
    } catch {
      res = await this.db.query({
        thread_items: {
          $: {
            where: { "thread.id": thread.id },
            limit: 1000,
          },
        },
      })
    }

    const items = ((res.thread_items as any) ?? []) as ThreadItem[]
    const toEpoch = (value: unknown): number => {
      if (value instanceof Date) return value.getTime()
      if (typeof value === "string" || typeof value === "number") {
        const ms = new Date(value as any).getTime()
        return Number.isFinite(ms) ? ms : 0
      }
      return 0
    }

    return [...items].sort((a: any, b: any) => {
      const ta = toEpoch(a?.createdAt ?? a?.updatedAt)
      const tb = toEpoch(b?.createdAt ?? b?.updatedAt)
      if (ta !== tb) return ta - tb
      return String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
    })
  }

  async createExecution(
    contextIdentifier: ContextIdentifier,
    triggerEventId: string,
    reactionEventId: string,
  ): Promise<{ id: string }> {
    const { context, thread } = await this.resolveThreadContext(contextIdentifier)
    const executionId = id()
    const execCreate = this.db.tx.thread_executions[executionId].create({
      createdAt: new Date(),
      status: "executing",
    })

    const txs: any[] = [execCreate]
    txs.push(this.db.tx.thread_executions[executionId].link({ context: context.id }))
    txs.push(this.db.tx.thread_executions[executionId].link({ thread: thread.id }))
    txs.push(this.db.tx.thread_contexts[context.id].link({ currentExecution: executionId }))

    txs.push(this.db.tx.thread_executions[executionId].link({ trigger: triggerEventId }))
    txs.push(this.db.tx.thread_executions[executionId].link({ reaction: reactionEventId }))
    txs.push(
      this.db.tx.thread_threads[thread.id].update({
        status: "streaming",
        updatedAt: new Date(),
      }),
    )

    try {
      await this.db.transact(txs)
    } catch (error) {
      logInstantTransactFailure({
        action: "createExecution",
        meta: {
          contextIdentifier: simplifyForLog(contextIdentifier),
          contextId: context.id,
          threadId: thread.id,
          executionId,
          triggerEventId,
          reactionEventId,
        },
        txs,
        error,
      })
      throw error
    }

    return { id: executionId }
  }

  async completeExecution(
    contextIdentifier: ContextIdentifier,
    executionId: string,
    status: "completed" | "failed",
  ): Promise<void> {
    const { context, thread } = await this.resolveThreadContext(contextIdentifier)
    const executionResult = await this.db.query({
      thread_executions: {
        $: { where: { id: executionId as any }, limit: 1 },
      },
    })
    const executionRow = (executionResult?.thread_executions as any[])?.[0]
    if (!executionRow) throw new Error("InstantStore: execution not found")
    const currentExecutionStatus = String(executionRow.status ?? "executing") as ExecutionStatus
    if (currentExecutionStatus !== status) {
      assertExecutionTransition(currentExecutionStatus, status)
    }
    if (context.status !== "open") {
      assertContextTransition(context.status, "open")
    }
    const nextThreadStatus = status === "failed" ? "failed" : "open"
    if (thread.status !== nextThreadStatus) {
      assertThreadTransition(thread.status, nextThreadStatus)
    }

    const txs: any[] = []
    txs.push(this.db.tx.thread_executions[executionId].update({ status, updatedAt: new Date() }))

    // Update context status back to "open" when execution completes
    txs.push(this.db.tx.thread_contexts[context.id].update({ status: "open", updatedAt: new Date() }))
    txs.push(
      this.db.tx.thread_threads[thread.id].update({
        status: nextThreadStatus,
        updatedAt: new Date(),
      }),
    )

    await this.db.transact(txs)
  }

  async createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string; eventId: string }> {
    const stepId = id()
    const eventId = id()

    const txs: any[] = [
      this.db.tx.thread_steps[stepId].create({
        createdAt: new Date(),
        status: "running",
        iteration: params.iteration,
        executionId: params.executionId,
        eventId,
      }),
    ]

    txs.push(this.db.tx.thread_steps[stepId].link({ execution: params.executionId }))

    try {
      await this.db.transact(txs)
    } catch (error) {
      logInstantTransactFailure({
        action: "createStep",
        meta: {
          executionId: params.executionId,
          iteration: params.iteration,
          stepId,
          eventId,
        },
        txs,
        error,
      })
      throw error
    }

    return { id: stepId, eventId }
  }

  async updateStep(
    stepId: string,
    patch: Partial<{
      status: "running" | "completed" | "failed"
      toolCalls: any
      toolExecutionResults: any
      continueLoop: boolean
      errorText: string
      updatedAt: Date
    }>,
  ): Promise<void> {
    if (patch.status) {
      const stepResult = await this.db.query({
        thread_steps: {
          $: { where: { id: stepId as any }, limit: 1 },
        },
      })
      const stepRow = (stepResult?.thread_steps as any[])?.[0]
      if (!stepRow) throw new Error("InstantStore: step not found")
      const currentStepStatus = String(stepRow.status ?? "running") as ThreadStepStatus
      if (currentStepStatus !== patch.status) {
        assertStepTransition(currentStepStatus, patch.status)
      }
    }

    const update: any = {
      ...(patch as any),
      updatedAt: patch.updatedAt ?? new Date(),
    }

    await this.db.transact([this.db.tx.thread_steps[stepId].update(update)])
  }

  async linkItemToExecution(params: { itemId: string; executionId: string }): Promise<void> {
    await this.db.transact([
      this.db.tx.thread_items[params.itemId].link({ execution: params.executionId }),
    ])
  }

  async saveStepParts(params: { stepId: string; parts: any[] }): Promise<void> {
    const parts = Array.isArray(params.parts) ? params.parts : []
    if (parts.length === 0) return

    const txs = parts.map((p, idx) => {
      const key = `${params.stepId}:${idx}`
      return this.db.tx.thread_parts[lookup("key", key)]
        .update({
          stepId: params.stepId,
          idx,
          type: typeof (p as any)?.type === "string" ? String((p as any).type) : undefined,
          part: p,
          updatedAt: new Date(),
        })
        .link({ step: params.stepId })
    })

    await this.db.transact(txs as any)
  }

  async itemsToModelMessages(events: ThreadItem[]): Promise<ModelMessage[]> {
    // Prefer parts-first reconstruction from thread_parts via the producing step.
    const eventIds = events.map((e: any) => String(e.id)).filter(Boolean)
    let eventsWithParts = events
    if (eventIds.length) {
      try {
        // 1) Get steps for these events (eventId is stored on thread_steps)
        const stepsRes = await this.db.query({
          thread_steps: {
            $: {
              where: { eventId: { $in: eventIds } },
              fields: ["id", "eventId"],
              limit: 2000,
            },
          },
        })
        const steps = (stepsRes.thread_steps as any[]) ?? []
        const stepIdByEventId = new Map<string, string>()
        const stepIds: string[] = []
        for (const s of steps) {
          const sid = String((s as any).id)
          const eid = String((s as any).eventId)
          if (sid && eid) {
            stepIdByEventId.set(eid, sid)
            stepIds.push(sid)
          }
        }

        // 2) Load parts for those steps
        const partsByStepId = new Map<string, any[]>()
        if (stepIds.length) {
          const partsRes = await this.db.query({
            thread_parts: {
              $: {
                where: { stepId: { $in: stepIds } },
                order: { idx: "asc" },
                limit: 5000,
              },
            },
          })
          const rows = (partsRes.thread_parts as any[]) ?? []
          for (const r of rows) {
            const sid = String((r as any).stepId)
            const arr = partsByStepId.get(sid) ?? []
            arr.push((r as any).part)
            partsByStepId.set(sid, arr)
          }
        }

        // 3) Attach parts onto events
        eventsWithParts = events.map((e: any) => {
          const eid = String(e.id)
          const sid = stepIdByEventId.get(eid)
          if (!sid) return e
          const parts = partsByStepId.get(sid)
          if (!parts || parts.length === 0) return e
          return { ...e, content: { ...(e?.content ?? {}), parts } }
        })
      } catch {
        // If schema not pushed yet (or table absent), fallback to embedded parts.
        eventsWithParts = events
      }
    }

    // Default behavior for Instant-backed stories:
    // - Expand file parts into derived `output_text` events (persisting parsed content into document_documents)
    // - Then convert expanded events to model messages
    const expanded = await expandEventsWithInstantDocuments({
      db: this.db,
      events: eventsWithParts,
      derivedEventType: "output_text",
    })
    return await convertItemsToModelMessages(expanded)
  }
}

/**
 * Helper to create a ThreadRuntimeResolver that returns an InstantStore.
 *
 * This keeps the app-level `ekairos.ts` extremely small.
 */
export function createInstantStoreRuntime(params: {
  getDb: (orgId: string) => Promise<InstantStoreDb> | InstantStoreDb
  getOrgId?: (env: Record<string, unknown>) => string
  domain?: DomainSchemaResult
}) {
  const storesByOrg = new Map<string, { store: InstantStore; db: InstantStoreDb; domain?: any }>()

  return async (env: Record<string, unknown>) => {
    const orgId =
      params.getOrgId?.(env) ??
      (typeof (env as any)?.orgId === "string" ? String((env as any).orgId) : "")
    if (!orgId) {
      throw new Error('[instant] Missing orgId in env. Provide env.orgId (or customize getOrgId).')
    }

    const cached = storesByOrg.get(orgId)
    if (cached) return cached

    const db = await params.getDb(orgId)
    const store = new InstantStore(db)
    const concreteDomain = params.domain?.fromDB ? params.domain.fromDB(db) : undefined
    const runtime = { store, db, domain: concreteDomain }
    storesByOrg.set(orgId, runtime)
    return runtime
  }
}



