import { i } from "@instantdb/core"
import { domain, type DomainSchemaResult } from "@ekairos/domain"

export const eventsDomain: DomainSchemaResult = domain("events")
    .schema({
        entities: {
            event_contexts: i.entity({
                createdAt: i.date(),
                updatedAt: i.date().optional(),
                key: i.string().optional().indexed().unique(),
                name: i.string().optional(),
                status: i.string().optional().indexed(), // open_idle | open_streaming | closed
                content: i.any().optional(),
            }),
            event_items: i.entity({
                channel: i.string().indexed(),
                createdAt: i.date().indexed(),
                type: i.string().optional().indexed(),
                content: i.any().optional(),
                status: i.string().optional().indexed(),
            }),
            event_executions: i.entity({
                createdAt: i.date(),
                updatedAt: i.date().optional(),
                status: i.string().optional().indexed(), // executing | completed | failed
                workflowRunId: i.string().optional().indexed(),
            }),
            event_steps: i.entity({
                createdAt: i.date().indexed(),
                updatedAt: i.date().optional(),
                status: i.string().optional().indexed(), // running | completed | failed
                iteration: i.number().indexed(),
                kind: i.string().optional().indexed(), // message | action_execute | action_result
                actionName: i.string().optional().indexed(),
                actionInput: i.any().optional(),
                actionOutput: i.any().optional(),
                actionError: i.string().optional(),
                actionRequests: i.any().optional(),
                actionResults: i.any().optional(),
                continueLoop: i.boolean().optional(),
                errorText: i.string().optional(),
            }),
            event_parts: i.entity({
                key: i.string().unique().indexed(), // `${stepId}:${idx}`
                stepId: i.string().indexed(),
                idx: i.number().indexed(),
                type: i.string().optional().indexed(),
                part: i.any().optional(),
                updatedAt: i.date().optional(),
            }),
            event_trace_events: i.entity({
                key: i.string().unique().indexed(), // `${workflowRunId}:${eventId}`
                workflowRunId: i.string().indexed(),
                seq: i.number().indexed(),
                eventId: i.string().indexed(),
                eventKind: i.string().indexed(),
                eventAt: i.date().optional(),
                ingestedAt: i.date().optional(),
                orgId: i.string().optional().indexed(),
                projectId: i.string().optional().indexed(),
                contextKey: i.string().optional().indexed(),
                contextId: i.string().optional().indexed(),
                executionId: i.string().optional().indexed(),
                stepId: i.string().optional().indexed(),
                contextEventId: i.string().optional().indexed(),
                toolCallId: i.string().optional().indexed(),
                partKey: i.string().optional().indexed(),
                partIdx: i.number().optional().indexed(),
                spanId: i.string().optional().indexed(),
                parentSpanId: i.string().optional().indexed(),
                isDeleted: i.boolean().optional(),
                aiProvider: i.string().optional().indexed(),
                aiModel: i.string().optional().indexed(),
                promptTokens: i.number().optional(),
                promptTokensCached: i.number().optional(),
                promptTokensUncached: i.number().optional(),
                completionTokens: i.number().optional(),
                totalTokens: i.number().optional(),
                latencyMs: i.number().optional(),
                cacheCostUsd: i.number().optional(),
                computeCostUsd: i.number().optional(),
                costUsd: i.number().optional(),
                payload: i.any().optional(),
            }),
            event_trace_runs: i.entity({
                workflowRunId: i.string().unique().indexed(),
                orgId: i.string().optional().indexed(),
                projectId: i.string().optional().indexed(),
                firstEventAt: i.date().optional().indexed(),
                lastEventAt: i.date().optional().indexed(),
                lastIngestedAt: i.date().optional().indexed(),
                eventsCount: i.number().optional(),
                status: i.string().optional().indexed(),
                payload: i.any().optional(),
            }),
            event_trace_spans: i.entity({
                spanId: i.string().unique().indexed(),
                parentSpanId: i.string().optional().indexed(),
                workflowRunId: i.string().indexed(),
                executionId: i.string().optional().indexed(),
                stepId: i.string().optional().indexed(),
                kind: i.string().optional().indexed(),
                name: i.string().optional().indexed(),
                status: i.string().optional().indexed(),
                startedAt: i.date().optional().indexed(),
                endedAt: i.date().optional().indexed(),
                durationMs: i.number().optional(),
                payload: i.any().optional(),
            }),
            document_documents: i.entity({
                name: i.string().optional().indexed(),
                mimeType: i.string().optional(),
                size: i.number().optional(),
                ownerId: i.string().optional().indexed(),
                orgId: i.string().optional().indexed(),
                createdAt: i.date().optional().indexed(),
                processedAt: i.date().optional().indexed(),
                updatedAt: i.date().optional(),
                lastJobId: i.string().optional(),
                content: i.json().optional(),
            }),
        },
        links: {
            contextItemsContext: {
                forward: { on: "event_items", has: "one", label: "context" },
                reverse: { on: "event_contexts", has: "many", label: "items" },
            },
            contextExecutionsContext: {
                forward: { on: "event_executions", has: "one", label: "context" },
                reverse: { on: "event_contexts", has: "many", label: "executions" },
            },
            contextCurrentExecution: {
                forward: { on: "event_contexts", has: "one", label: "currentExecution" },
                reverse: { on: "event_executions", has: "one", label: "currentOf" },
            },
            contextExecutionsTrigger: {
                forward: { on: "event_executions", has: "one", label: "trigger" },
                reverse: { on: "event_items", has: "many", label: "executionsAsTrigger" },
            },
            contextExecutionsReaction: {
                forward: { on: "event_executions", has: "one", label: "reaction" },
                reverse: { on: "event_items", has: "many", label: "executionsAsReaction" },
            },
            contextStepsExecution: {
                forward: { on: "event_steps", has: "one", label: "execution" },
                reverse: { on: "event_executions", has: "many", label: "steps" },
            },
            contextExecutionItems: {
                forward: { on: "event_items", has: "one", label: "execution" },
                reverse: { on: "event_executions", has: "many", label: "items" },
            },
            contextPartsStep: {
                forward: { on: "event_parts", has: "one", label: "step" },
                reverse: { on: "event_steps", has: "many", label: "parts" },
            },
            documentFile: {
                forward: {
                    on: "document_documents",
                    has: "one",
                    label: "file",
                },
                reverse: {
                    on: "$files",
                    has: "one",
                    label: "document",
                },
            },
        },
        rooms: {},
    })
