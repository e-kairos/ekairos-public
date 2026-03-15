import "../polyfills/dom-events.js"
import { id, lookup } from "@instantdb/admin"

import { eventsDomain } from "../schema.js"
import type { DomainSchemaResult } from "@ekairos/domain"
import { convertItemsToModelMessages } from "../context.events.js"
import {
  assertContextTransition,
  assertExecutionTransition,
  assertItemTransition,
  assertStepTransition,
  type ExecutionStatus,
  type StepStatus,
} from "../context.contract.js"
import type { ModelMessage } from "ai"
import type {
  ContextItem,
  ContextIdentifier,
  ContextStatus,
  StoredContext,
  ContextStore,
} from "../context.store.js"
export { parseAndStoreDocument } from "./instant.document-parser.js"
import { expandEventsWithInstantDocuments } from "./instant.documents.js"
export {
  coerceDocumentTextPages,
  expandEventsWithInstantDocuments,
} from "./instant.documents.js"

export type InstantStoreDb = any

function shouldDebugInstantStore() {
  return (
    process.env.EKAIROS_CONTEXT_DEBUG === "1" ||
    process.env.EKAIROS_CONTEXT_DEBUG === "1" ||
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

function ensureValidEntityId(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) {
    throw new Error(`InstantStore: ${label} is required`)
  }
  return normalized
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
  console.error("[context][instant.store] transact failed", payload)
}

function sortItems<T extends { id?: unknown; createdAt?: unknown; updatedAt?: unknown }>(items: T[]) {
  const toEpoch = (value: unknown): number => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === "string" || typeof value === "number") {
      const ms = new Date(value as any).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    return 0
  }

  return [...items].sort((a, b) => {
    const ta = toEpoch(a?.createdAt ?? a?.updatedAt)
    const tb = toEpoch(b?.createdAt ?? b?.updatedAt)
    if (ta !== tb) return ta - tb
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
  })
}

export class InstantStore implements ContextStore {
  private db: any

  constructor(db: InstantStoreDb) {
    this.db = db
  }

  private normalizeContext<C>(row: any): StoredContext<C> {
    return {
      id: String(row?.id ?? ""),
      key: typeof row?.key === "string" && row.key.length > 0 ? row.key : null,
      name: typeof row?.name === "string" ? row.name : null,
      status: (typeof row?.status === "string" ? row.status : "open_idle") as ContextStatus,
      createdAt:
        row?.createdAt instanceof Date ? row.createdAt : new Date(row?.createdAt ?? Date.now()),
      updatedAt:
        row?.updatedAt instanceof Date
          ? row.updatedAt
          : row?.updatedAt
            ? new Date(row.updatedAt)
            : undefined,
      content: (row?.content as C) ?? null,
    }
  }

  private async ensureContextKey<C>(
    context: StoredContext<C>,
    expectedKey?: string | null,
  ): Promise<StoredContext<C>> {
    if (!expectedKey) return context
    if (context.key === expectedKey) return context

    await this.db.transact([
      this.db.tx.event_contexts[context.id].update({
        key: expectedKey,
        updatedAt: new Date(),
      }),
    ])

    const refreshed = await this.getContext<C>({ id: context.id })
    return refreshed ?? { ...context, key: expectedKey }
  }

  private async createContextRecord<C>(
    contextIdentifier: ContextIdentifier | null,
  ): Promise<StoredContext<C>> {
    const contextId: string =
      contextIdentifier && "id" in contextIdentifier ? String(contextIdentifier.id) : id()
    const key = contextIdentifier && "key" in contextIdentifier ? contextIdentifier.key : undefined

    await this.db.transact([
      this.db.tx.event_contexts[contextId].create({
        createdAt: new Date(),
        updatedAt: new Date(),
        key,
        status: "open_idle",
        content: {},
      }),
    ])

    const context = await this.getContext<C>({ id: contextId })
    if (!context) {
      throw new Error("InstantStore: failed to create context")
    }
    return context
  }

  async getOrCreateContext<C>(
    contextIdentifier: ContextIdentifier | null,
  ): Promise<StoredContext<C>> {
    if (!contextIdentifier) {
      return await this.createContextRecord<C>(null)
    }

    const existing = await this.getContext<C>(contextIdentifier)
    if (existing) {
      if ("key" in contextIdentifier) {
        return await this.ensureContextKey(existing, contextIdentifier.key)
      }
      return existing
    }

    return await this.createContextRecord<C>(contextIdentifier)
  }

  async getContext<C>(
    contextIdentifier: ContextIdentifier,
  ): Promise<StoredContext<C> | null> {
    try {
      if ("id" in contextIdentifier) {
        const res = await this.db.query({
          event_contexts: {
            $: { where: { id: contextIdentifier.id as any }, limit: 1 },
          },
        })
        const row = (res?.event_contexts as any[])?.[0]
        return row ? this.normalizeContext<C>(row) : null
      }

      const res = await this.db.query({
        event_contexts: {
          $: { where: { key: contextIdentifier.key }, limit: 1 },
        },
      })
      const row = (res?.event_contexts as any[])?.[0]
      return row ? this.normalizeContext<C>(row) : null
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
      this.db.tx.event_contexts[context.id].update({
        content: content as any,
        updatedAt: new Date(),
      }),
    ])

    const updated = await this.getContext<C>({ id: context.id })
    if (!updated) throw new Error("InstantStore: context not found after update")
    return updated
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

    await this.db.transact([
      this.db.tx.event_contexts[context.id].update({
        status,
        updatedAt: new Date(),
      }),
    ])
  }

  private async resolveContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C>> {
    const context = await this.getContext<C>(contextIdentifier)
    if (!context?.id) throw new Error("InstantStore: context not found")
    return context
  }

  async saveItem(
    contextIdentifier: ContextIdentifier,
    event: ContextItem,
  ): Promise<ContextItem> {
    const eventId = ensureValidEntityId((event as any)?.id, "event.id")
    const context = await this.resolveContext(contextIdentifier)
    const existing = await this.getItem(eventId)
    if (existing?.status && existing.status !== "stored") {
      assertItemTransition(existing.status, "stored")
    }
    const txs = [
      this.db.tx.event_items[eventId].update({
        ...(event as any),
        id: eventId,
        status: "stored",
      }),
      this.db.tx.event_items[eventId].link({ context: context.id }),
    ]

    try {
      await this.db.transact(txs as any)
    } catch (error) {
      logInstantTransactFailure({
        action: "saveItem",
        meta: {
          contextIdentifier: simplifyForLog(contextIdentifier),
          contextId: context.id,
          eventId,
          eventType: (event as any)?.type,
          eventChannel: (event as any)?.channel,
          eventCreatedAt: (event as any)?.createdAt,
        },
        txs,
        error,
      })
      throw error
    }

    return {
      ...(event as any),
      id: eventId,
      status: "stored",
    } as ContextItem
  }

  async updateItem(eventId: string, event: ContextItem): Promise<ContextItem> {
    const current = await this.getItem(eventId)
    if (current?.status && event.status && current.status !== event.status) {
      assertItemTransition(current.status, event.status)
    }
    await this.db.transact([this.db.tx.event_items[eventId].update(event as any)])
    return {
      ...(current as any),
      ...(event as any),
      id: eventId,
    } as ContextItem
  }

  async getItem(eventId: string): Promise<ContextItem | null> {
    const res = await this.db.query({
      event_items: {
        $: { where: { id: eventId as any } },
      },
    })
    return (res.event_items?.[0] as any) ?? null
  }

  async getItems(contextIdentifier: ContextIdentifier): Promise<ContextItem[]> {
    const context = await this.resolveContext(contextIdentifier)
    let res: any
    try {
      res = await this.db.query({
        event_items: {
          $: {
            where: { context: context.id as any },
            limit: 1000,
          },
        },
      })
    } catch {
      res = await this.db.query({
        event_items: {
          $: {
            where: { "context.id": context.id },
            limit: 1000,
          },
        },
      })
    }

    return sortItems(((res.event_items as any) ?? []) as ContextItem[])
  }

  async createExecution(
    contextIdentifier: ContextIdentifier,
    triggerEventId: string,
    reactionEventId: string,
  ): Promise<{ id: string }> {
    const normalizedTriggerEventId = ensureValidEntityId(triggerEventId, "triggerEventId")
    const normalizedReactionEventId = ensureValidEntityId(reactionEventId, "reactionEventId")
    const context = await this.resolveContext(contextIdentifier)
    const executionId = id()
    const currentStatus = context.status

    if (currentStatus === "closed") {
      throw new Error("InstantStore: context must be reopened before creating an execution")
    }
    if (currentStatus !== "open_streaming") {
      assertContextTransition(currentStatus, "open_streaming")
    }

    const txs: any[] = [
      this.db.tx.event_executions[executionId].create({
        createdAt: new Date(),
        status: "executing",
      }),
      this.db.tx.event_contexts[context.id].update({
        status: "open_streaming",
        updatedAt: new Date(),
      }),
      this.db.tx.event_executions[executionId].link({ context: context.id }),
      this.db.tx.event_contexts[context.id].link({ currentExecution: executionId }),
      this.db.tx.event_executions[executionId].link({ trigger: normalizedTriggerEventId }),
      this.db.tx.event_executions[executionId].link({ reaction: normalizedReactionEventId }),
    ]

    try {
      await this.db.transact(txs)
    } catch (error) {
      logInstantTransactFailure({
        action: "createExecution",
        meta: {
          contextIdentifier: simplifyForLog(contextIdentifier),
          contextId: context.id,
          executionId,
          triggerEventId: normalizedTriggerEventId,
          reactionEventId: normalizedReactionEventId,
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
    const context = await this.resolveContext(contextIdentifier)
    const executionResult = await this.db.query({
      event_executions: {
        $: { where: { id: executionId as any }, limit: 1 },
      },
    })
    const executionRow = (executionResult?.event_executions as any[])?.[0]
    if (!executionRow) throw new Error("InstantStore: execution not found")

    const currentExecutionStatus = String(executionRow.status ?? "executing") as ExecutionStatus
    if (currentExecutionStatus !== status) {
      assertExecutionTransition(currentExecutionStatus, status)
    }
    if (context.status !== "closed") {
      assertContextTransition(context.status, "closed")
    }

    await this.db.transact([
      this.db.tx.event_executions[executionId].update({ status, updatedAt: new Date() }),
      this.db.tx.event_contexts[context.id].update({
        status: "closed",
        updatedAt: new Date(),
      }),
    ])
  }

  async createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string }> {
    const stepId = id()

    const txs: any[] = [
      this.db.tx.event_steps[stepId].create({
        createdAt: new Date(),
        status: "running",
        iteration: params.iteration,
      }),
      this.db.tx.event_steps[stepId].link({ execution: params.executionId }),
    ]

    try {
      await this.db.transact(txs)
    } catch (error) {
      logInstantTransactFailure({
        action: "createStep",
        meta: {
          executionId: params.executionId,
          iteration: params.iteration,
          stepId,
        },
        txs,
        error,
      })
      throw error
    }

    return { id: stepId }
  }

  async updateStep(
    stepId: string,
    patch: Partial<{
      status: "running" | "completed" | "failed"
      kind: "message" | "action_execute" | "action_result"
      actionName: string
      actionInput: unknown
      actionOutput: unknown
      actionError: string
      actionRequests: any
      actionResults: any
      continueLoop: boolean
      errorText: string
      updatedAt: Date
    }>,
  ): Promise<void> {
    if (patch.status) {
      const stepResult = await this.db.query({
        event_steps: {
          $: { where: { id: stepId as any }, limit: 1 },
        },
      })
      const stepRow = (stepResult?.event_steps as any[])?.[0]
      if (!stepRow) throw new Error("InstantStore: step not found")
      const currentStepStatus = String(stepRow.status ?? "running") as StepStatus
      if (currentStepStatus !== patch.status) {
        assertStepTransition(currentStepStatus, patch.status)
      }
    }

    const update: any = {
      ...(patch as any),
      updatedAt: patch.updatedAt ?? new Date(),
    }

    await this.db.transact([this.db.tx.event_steps[stepId].update(update)])
  }

  async linkItemToExecution(params: { itemId: string; executionId: string }): Promise<void> {
    await this.db.transact([
      this.db.tx.event_items[params.itemId].link({ execution: params.executionId }),
    ])
  }

  async saveStepParts(params: { stepId: string; parts: any[] }): Promise<void> {
    const parts = Array.isArray(params.parts) ? params.parts : []
    if (parts.length === 0) return

    const txs = parts.map((part, idx) => {
      const key = `${params.stepId}:${idx}`
      return this.db.tx.event_parts[lookup("key", key)]
        .update({
          stepId: params.stepId,
          idx,
          type: typeof (part as any)?.type === "string" ? String((part as any).type) : undefined,
          part,
          updatedAt: new Date(),
        })
        .link({ step: params.stepId })
    })

    await this.db.transact(txs as any)
  }

  async itemsToModelMessages(events: ContextItem[]): Promise<ModelMessage[]> {
    const expanded = await expandEventsWithInstantDocuments({
      db: this.db,
      events,
      derivedEventType: "output",
    })
    return await convertItemsToModelMessages(expanded)
  }
}

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
      throw new Error("[instant] Missing orgId in env. Provide env.orgId (or customize getOrgId).")
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
