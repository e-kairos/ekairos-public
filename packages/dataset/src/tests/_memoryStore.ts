import type {
  ContextEvent,
  ContextIdentifier,
  ContextStatus,
  ExecutionStatus,
  StoredContext,
  StoryStore,
} from "@ekairos/thread"
import { convertItemsToModelMessages } from "@ekairos/thread"
import type { ModelMessage } from "ai"

type ContextRow = StoredContext<any>

export class MemoryStoryStore implements StoryStore {
  private contextsById = new Map<string, ContextRow>()
  private contextsByKey = new Map<string, string>()
  private eventsById = new Map<string, ContextEvent>()
  private eventsByContextId = new Map<string, string[]>()
  private stepsById = new Map<
    string,
    {
      id: string
      status: "running" | "completed" | "failed"
      iteration: number
      executionId: string
      triggerEventId: string
      reactionEventId: string
      eventId: string
      toolCalls?: any
      toolExecutionResults?: any
      continueLoop?: boolean
      errorText?: string
      createdAt: Date
      updatedAt?: Date
    }
  >()

  async getOrCreateContext<C>(
    contextIdentifier: ContextIdentifier | null,
  ): Promise<StoredContext<C>> {
    if (!contextIdentifier) {
      const id = this.makeId()
      const ctx: ContextRow = {
        id,
        key: null,
        status: "open",
        createdAt: new Date(),
        content: {} as any,
      }
      this.contextsById.set(id, ctx)
      return ctx as any
    }

    const existing = await this.getContext<C>(contextIdentifier)
    if (existing) return existing

    const id = "id" in contextIdentifier ? contextIdentifier.id : this.makeId()
    const key = "key" in contextIdentifier ? contextIdentifier.key : null
    const ctx: ContextRow = {
      id,
      key: key ?? null,
      status: "open",
      createdAt: new Date(),
      content: {} as any,
    }
    this.contextsById.set(id, ctx)
    if (key) this.contextsByKey.set(key, id)
    return ctx as any
  }

  async getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C> | null> {
    const id =
      "id" in contextIdentifier
        ? contextIdentifier.id
        : this.contextsByKey.get(contextIdentifier.key) ?? null
    if (!id) return null
    return (this.contextsById.get(id) as any) ?? null
  }

  async updateContextContent<C>(
    contextIdentifier: ContextIdentifier,
    content: C,
  ): Promise<StoredContext<C>> {
    const ctx = await this.getOrCreateContext<C>(contextIdentifier)
    const updated: ContextRow = {
      ...(ctx as any),
      content: content as any,
      updatedAt: new Date(),
    }
    this.contextsById.set(updated.id, updated)
    if (updated.key) this.contextsByKey.set(updated.key, updated.id)
    return updated as any
  }

  async updateContextStatus(
    contextIdentifier: ContextIdentifier,
    status: ContextStatus,
  ): Promise<void> {
    const ctx = await this.getOrCreateContext<any>(contextIdentifier)
    const updated: ContextRow = { ...(ctx as any), status, updatedAt: new Date() }
    this.contextsById.set(updated.id, updated)
  }

  async saveEvent(
    contextIdentifier: ContextIdentifier,
    event: ContextEvent,
  ): Promise<ContextEvent> {
    const ctx = await this.getOrCreateContext<any>(contextIdentifier)
    this.eventsById.set(event.id, event)
    const list = this.eventsByContextId.get(ctx.id) ?? []
    list.push(event.id)
    this.eventsByContextId.set(ctx.id, list)
    return event
  }

  async updateEvent(eventId: string, event: ContextEvent): Promise<ContextEvent> {
    this.eventsById.set(eventId, event)
    return event
  }

  async getEvent(eventId: string): Promise<ContextEvent | null> {
    return this.eventsById.get(eventId) ?? null
  }

  async getEvents(contextIdentifier: ContextIdentifier): Promise<ContextEvent[]> {
    const ctx = await this.getOrCreateContext<any>(contextIdentifier)
    const ids = this.eventsByContextId.get(ctx.id) ?? []
    return ids.map((id) => this.eventsById.get(id)!).filter(Boolean)
  }

  async createExecution(
    _contextIdentifier: ContextIdentifier,
    _triggerEventId: string,
    _reactionEventId: string,
  ): Promise<{ id: string }> {
    return { id: this.makeId() }
  }

  async completeExecution(
    _contextIdentifier: ContextIdentifier,
    _executionId: string,
    _status: Exclude<ExecutionStatus, "executing">,
  ): Promise<void> {
    // no-op
  }

  async createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string; eventId: string }> {
    const stepId = this.makeId()
    const eventId = this.makeId()
    this.stepsById.set(stepId, {
      id: stepId,
      status: "running",
      iteration: params.iteration,
      executionId: params.executionId,
      eventId,
      createdAt: new Date(),
    })

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
    const existing = this.stepsById.get(stepId)
    if (!existing) return
    this.stepsById.set(stepId, {
      ...existing,
      ...(patch as any),
      updatedAt: patch.updatedAt ?? new Date(),
    })
  }

  async linkEventToExecution(_params: { eventId: string; executionId: string }): Promise<void> {
    // no-op for in-memory tests unless explicitly asserted elsewhere
  }

  async saveStepParts(_params: { stepId: string; parts: any[] }): Promise<void> {
    // no-op for in-memory tests
  }

  async eventsToModelMessages(events: ContextEvent[]): Promise<ModelMessage[]> {
    return (await convertItemsToModelMessages(events)) as any
  }

  private makeId() {
    const uuid = (globalThis.crypto as any)?.randomUUID?.()
    return typeof uuid === "string" ? uuid : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

