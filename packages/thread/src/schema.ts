import { i } from "@instantdb/core";
import { domain, type DomainSchemaResult } from "@ekairos/domain";

export const threadDomain: DomainSchemaResult = domain("thread")
    .schema({
        entities: {
            thread_threads: i.entity({
                createdAt: i.date(),
                updatedAt: i.date().optional(),
                key: i.string().optional().indexed().unique(),
                name: i.string().optional(),
                status: i.string().optional().indexed(), // open | streaming | closed | failed
            }),
            thread_contexts: i.entity({
                createdAt: i.date(),
                updatedAt: i.date().optional(),
                // Required for prefix/history queries that use `$like` over context keys.
                key: i.string().optional().indexed().unique(),
                status: i.string().optional().indexed(), // open | streaming | closed
                content: i.any().optional(),
            }),
            thread_items: i.entity({
                channel: i.string().indexed(),
                createdAt: i.date().indexed(),
                type: i.string().optional().indexed(),
                content: i.any().optional(),
                status: i.string().optional().indexed(),
            }),
            thread_executions: i.entity({
                createdAt: i.date(),
                updatedAt: i.date().optional(),
                status: i.string().optional().indexed(), // executing | completed | failed
                workflowRunId: i.string().optional().indexed(),
            }),
            thread_steps: i.entity({
                createdAt: i.date().indexed(),
                updatedAt: i.date().optional(),
                status: i.string().optional().indexed(), // running | completed | failed
                iteration: i.number().indexed(),
                // Deterministic ids generated in step runtime; stored for convenience/debugging
                executionId: i.string().indexed(),
                triggerEventId: i.string().indexed().optional(),
                reactionEventId: i.string().indexed().optional(),
                eventId: i.string().indexed(),
                toolCalls: i.any().optional(),
                toolExecutionResults: i.any().optional(),
                continueLoop: i.boolean().optional(),
                errorText: i.string().optional(),
            }),
            // Normalized parts (parts-first persistence). These hang off the step that produced them.
            // We still keep `thread_items.content.parts` for back-compat.
            thread_parts: i.entity({
                key: i.string().unique().indexed(), // `${stepId}:${idx}`
                stepId: i.string().indexed(),
                idx: i.number().indexed(),
                type: i.string().optional().indexed(),
                part: i.any().optional(),
                updatedAt: i.date().optional(),
            }),
            thread_trace_events: i.entity({
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
            thread_trace_runs: i.entity({
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
            thread_trace_spans: i.entity({
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
            // Documents (moved from schema-document.ts)
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
                content: i.json().optional(), // Store parsed content (pages, text, etc.)
            }),
        },
        links: {
            // Contexts belong to a thread
            threadContextsThread: {
                forward: { on: "thread_contexts", has: "one", label: "thread" },
                reverse: { on: "thread_threads", has: "many", label: "contexts" },
            },
            // Items belong to a thread (conversation timeline)
            threadItemsThread: {
                forward: { on: "thread_items", has: "one", label: "thread" },
                reverse: { on: "thread_threads", has: "many", label: "items" },
            },
            threadItemsContext: {
                forward: { on: "thread_items", has: "one", label: "context" },
                reverse: { on: "thread_contexts", has: "many", label: "items" },
            },
            // Executions belong to a context
            threadExecutionsContext: {
                forward: { on: "thread_executions", has: "one", label: "context" },
                reverse: { on: "thread_contexts", has: "many", label: "executions" },
            },
            // Executions also belong to a thread
            threadExecutionsThread: {
                forward: { on: "thread_executions", has: "one", label: "thread" },
                reverse: { on: "thread_threads", has: "many", label: "executions" },
            },
            // Current execution pointer on a context
            threadContextsCurrentExecution: {
                forward: { on: "thread_contexts", has: "one", label: "currentExecution" },
                reverse: { on: "thread_executions", has: "one", label: "currentOf" },
            },
            // Link execution to its trigger event
            threadExecutionsTrigger: {
                forward: { on: "thread_executions", has: "one", label: "trigger" },
                reverse: { on: "thread_items", has: "many", label: "executionsAsTrigger" },
            },
            // Link execution to its reaction event
            threadExecutionsReaction: {
                forward: { on: "thread_executions", has: "one", label: "reaction" },
                reverse: { on: "thread_items", has: "many", label: "executionsAsReaction" },
            },
            // Steps belong to an execution
            threadStepsExecution: {
                forward: { on: "thread_steps", has: "one", label: "execution" },
                reverse: { on: "thread_executions", has: "many", label: "steps" },
            },
            // Iteration events belong to an execution (enables: event -> execution -> steps)
            threadExecutionItems: {
                forward: { on: "thread_items", has: "one", label: "execution" },
                reverse: { on: "thread_executions", has: "many", label: "items" },
            },
            // Parts belong to a step
            threadPartsStep: {
                forward: { on: "thread_parts", has: "one", label: "step" },
                reverse: { on: "thread_steps", has: "many", label: "parts" },
            },
            // Documents (moved from schema-document.ts)
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
    });



