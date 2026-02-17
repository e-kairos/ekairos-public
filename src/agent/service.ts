import { id, init, InstaQLEntity, lookup } from "@instantdb/admin"
import { agentDomain } from "./schema"

export type StoredContext<Context> = Omit<InstaQLEntity<typeof agentDomain, 'agent_contexts'>, 'content'> & { content: Context }
export type ContextIdentifier = { id: string; key?: never } | { key: string; id?: never }

export type ContextEvent = InstaQLEntity<typeof agentDomain, 'agent_events'> & { content: any }

export type StreamChunk = {
    type: string
    messageId?: string
    content?: string
    [key: string]: unknown
}

export class AgentService {

    private db: ReturnType<typeof init>

    constructor() {
        this.db = init({
            appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
            adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string, 
            schema: agentDomain.schema()
        })
    }

    public async getOrCreateContext<C>(contextIdentifier: ContextIdentifier | null): Promise<StoredContext<C>> {
        if (!contextIdentifier) {
            return this.createContext<C>()
        }

        let context = await this.getContext<C>(contextIdentifier)
        if (!context) {
            return this.createContext<C>(contextIdentifier.key ? { key: contextIdentifier.key } : null, contextIdentifier.id)
        } else {
            return context
        }
    }

    public async createContext<C>(contextKey?: { key: string } | null, contextId?: string): Promise<StoredContext<C>> {
        let contextData: { createdAt: Date; content: Record<string, unknown>; key: string | null } = {
            createdAt: new Date(),
            content: {},
            key: null
        }

        const newContextId = contextId ?? id()
        if (contextKey?.key) {
            contextData = {
                ...contextData,
                key: contextKey.key
            }
        }

        await this.db.transact([
            this.db.tx.agent_contexts[newContextId].create(contextData)
        ])
        return this.getContext<C>({ id: newContextId })
    }

    public async getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C>> {
        let context;
        try {
            if (contextIdentifier.id) {
                const tRes = await this.db.query({
                    agent_contexts: {
                        $: { where: { id: contextIdentifier.id }, limit: 1 }
                    }
                })
                context = tRes.agent_contexts?.[0]
            }

            if (contextIdentifier.key) {
                const tRes = await this.db.query({
                    agent_contexts: {
                        $: { where: { key: contextIdentifier.key } }
                    }
                })
                context = tRes.agent_contexts?.[0]
            }

            return context as StoredContext<C>
        } catch (error: any) {
            console.error("Error getting context", error)
            throw new Error("Error getting context: " + error.message)
        }
    }

    public async updateContextContent<C>(contextIdentifier: ContextIdentifier, content: C): Promise<StoredContext<C>> {

        const contextDBIdentifier = contextIdentifier.id ?? lookup("key", contextIdentifier.key)

        await this.db.transact([
            this.db.tx.agent_contexts[contextDBIdentifier].update({
                content: content,
                updatedAt: new Date()
            })
        ])

        return this.getContext<C>(contextIdentifier)
    }

    public async saveEvent(contextIdentifier: ContextIdentifier, event: ContextEvent): Promise<ContextEvent> {
        const txs = [
            this.db.tx.agent_events[event.id].create({
                ...event,
                status: "stored"
            })
        ]

        if (contextIdentifier.id) {
            txs.push(this.db.tx.agent_events[event.id].link({ context: contextIdentifier.id }))
        } else {
            txs.push(this.db.tx.agent_events[event.id].link({ context: lookup("key", contextIdentifier.key) }))
        }

        await this.db.transact(txs)

        return await this.getEvent(event.id)
    }

    public async createExecution(contextIdentifier: ContextIdentifier, triggerEventId: string, reactionEventId: string): Promise<{ id: string }> {
        const executionId = id()
        const execCreate = this.db.tx.agent_executions[executionId].create({
            createdAt: new Date(),
            status: "executing",
        })

        const txs: any[] = [execCreate]

        if (contextIdentifier.id) {
            txs.push(this.db.tx.agent_executions[executionId].link({ context: contextIdentifier.id }))
            txs.push(this.db.tx.agent_contexts[contextIdentifier.id].update({ status: "executing" }))
            txs.push(this.db.tx.agent_contexts[contextIdentifier.id].link({ currentExecution: executionId }))
        } else {
            const ctxLookup = lookup("key", contextIdentifier.key)
            txs.push(this.db.tx.agent_executions[executionId].link({ context: ctxLookup }))
            txs.push(this.db.tx.agent_contexts[ctxLookup].update({ status: "executing" }))
            txs.push(this.db.tx.agent_contexts[ctxLookup].link({ currentExecution: executionId }))
        }

        txs.push(this.db.tx.agent_executions[executionId].link({ trigger: triggerEventId }))
        txs.push(this.db.tx.agent_executions[executionId].link({ reaction: reactionEventId }))

        await this.db.transact(txs)

        return { id: executionId }
    }

    public async completeExecution(contextIdentifier: ContextIdentifier, executionId: string, status: "completed" | "failed"): Promise<void> {
        const txs: any[] = []
        txs.push(this.db.tx.agent_executions[executionId].update({ status, updatedAt: new Date() }))

        if (contextIdentifier.id) {
            txs.push(this.db.tx.agent_contexts[contextIdentifier.id].update({ status: "open" }))
            // optionally unlink currentExecution if desired
        } else {
            txs.push(this.db.tx.agent_contexts[lookup("key", contextIdentifier.key)].update({ status: "open" }))
        }

        await this.db.transact(txs)
    }

    public async updateEvent(eventId: string, event: ContextEvent): Promise<ContextEvent> {
        await this.db.transact([
            this.db.tx.agent_events[eventId].update(event)
        ])
        return await this.getEvent(eventId)
    }

    public async getEvent(eventId: string): Promise<ContextEvent> {
        const event = await this.db.query({
            agent_events: {
                $: { where: { id: eventId } }
            }
        })
        return event.agent_events?.[0] as ContextEvent
    }

    public async getEvents(contextIdentifier: ContextIdentifier): Promise<ContextEvent[]> {

        let contextWhere;
        if (contextIdentifier.id) {
            contextWhere = { context: contextIdentifier.id }
        } else {
            contextWhere = { context: lookup("key", contextIdentifier.key) }
        }

        const events = await this.db.query({
            agent_events: {
                $: {
                    where: contextWhere,
                    limit: 30,
                    order: {
                        createdAt: 'desc',
                    },
                }
            }
        })
        return events.agent_events as ContextEvent[]
    }

    public async readEventStream(stream: ReadableStream): Promise<{
        eventId: string | undefined
        chunks: StreamChunk[]
        persistedEvent: any
    }> {
        const reader = stream.getReader()
        const chunks: StreamChunk[] = []
        let firstChunk: StreamChunk | undefined

        while (true) {
            const { value, done } = await reader.read()
            if (done) {
                break
            }
            const currentChunk = value as StreamChunk
            if (!firstChunk) {
                firstChunk = currentChunk
            }
            chunks.push(currentChunk)
        }

        if (!firstChunk) {
            throw new Error("No chunks received from stream")
        }

        const eventId = firstChunk.messageId

        const query = await this.db.query({
            agent_events: {
                $: {
                    where: { id: eventId },
                    limit: 1,
                    fields: ["id", "channel", "type", "status", "createdAt", "content"],
                },
            },
        })

        const persistedEvent = Array.isArray(query.agent_events) ? query.agent_events[0] : undefined

        return {
            eventId,
            chunks,
            persistedEvent,
        }
    }
}