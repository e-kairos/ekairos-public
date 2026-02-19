# @ekairos/thread

Durable thread engine for Workflow-compatible AI agents.

`@ekairos/thread` is the execution layer used by Ekairos agents. It persists context, items, steps, parts, and executions, while streaming UI chunks and enforcing transition contracts.

## Install

```bash
pnpm add @ekairos/thread
```

Optional subpaths:

- `@ekairos/thread/runtime`
- `@ekairos/thread/schema`
- `@ekairos/thread/instant`
- `@ekairos/thread/codex`
- `@ekairos/thread/mcp`
- `@ekairos/thread/oidc`

## Package Surface (from `src/index.ts`)

### Core builders and engine

- `createThread`
- `thread`
- `Thread`
- `type ThreadConfig`
- `type ThreadInstance`
- `type RegistrableThreadBuilder`
- `type ThreadOptions`
- `type ThreadStreamOptions`

### Reactors

- `createAiSdkReactor`
- `createScriptedReactor`
- `type ThreadReactor`
- `type ThreadReactorParams`
- `type ThreadReactionResult`
- `type ThreadReactionToolCall`
- `type ThreadReactionLLM`
- `type CreateAiSdkReactorOptions`
- `type CreateScriptedReactorOptions`
- `type ScriptedReactorStep`

### Contracts and transitions

- `THREAD_STATUSES`
- `THREAD_CONTEXT_STATUSES`
- `THREAD_EXECUTION_STATUSES`
- `THREAD_STEP_STATUSES`
- `THREAD_ITEM_STATUSES`
- `THREAD_ITEM_TYPES`
- `THREAD_CHANNELS`
- `THREAD_TRACE_EVENT_KINDS`
- `THREAD_STREAM_CHUNK_TYPES`
- `THREAD_CONTEXT_SUBSTATE_KEYS`
- `THREAD_THREAD_TRANSITIONS`
- `THREAD_CONTEXT_TRANSITIONS`
- `THREAD_EXECUTION_TRANSITIONS`
- `THREAD_STEP_TRANSITIONS`
- `THREAD_ITEM_TRANSITIONS`
- `can*Transition`, `assert*Transition`
- `assertThreadPartKey`

### Stream and parsing

- `parseThreadStreamEvent`
- `assertThreadStreamTransitions`
- `validateThreadStreamTimeline`
- `type ThreadStreamEvent`
- `type ContextCreatedEvent`
- `type ContextResolvedEvent`
- `type ContextStatusChangedEvent`
- `type ThreadCreatedEvent`
- `type ThreadResolvedEvent`
- `type ThreadStatusChangedEvent`
- `type ExecutionCreatedEvent`
- `type ExecutionStatusChangedEvent`
- `type ItemCreatedEvent`
- `type ItemStatusChangedEvent`
- `type StepCreatedEvent`
- `type StepStatusChangedEvent`
- `type PartCreatedEvent`
- `type PartUpdatedEvent`
- `type ChunkEmittedEvent`
- `type ThreadFinishedEvent`

### Event conversion helpers

- `createUserItemFromUIMessages`
- `createAssistantItemFromUIMessages`
- `convertToUIMessage`
- `convertItemToModelMessages`
- `convertItemsToModelMessages`
- `convertModelMessageToItem`
- `didToolExecute`
- `extractToolCallsFromParts`

### React hook

- `useThread`
- `type UseThreadOptions`
- `type ThreadSnapshot`
- `type ThreadStreamChunk`

### Registry / codex

- `registerThread`
- `getThread`
- `getThreadFactory`
- `hasThread`
- `listThreads`
- `createCodexThreadBuilder`
- codex defaults/types from `codex.ts`

## Thread API Specification

## `createThread`

```ts
createThread<Env>(key: ThreadKey)
```

Builder stages:

1. `.context((storedContext, env) => context)` (required)
2. `.expandEvents((events, context, env) => events)` (optional)
3. `.narrative((context, env) => string)` (required)
4. `.actions((context, env) => Record<string, ThreadTool>)` (required)
5. `.model(modelInit | selector)` (optional)
6. `.reactor(reactor)` (optional, default is AI SDK reactor)
7. `.shouldContinue(({ reactionEvent, toolCalls, toolExecutionResults, ... }) => boolean)` (optional)
8. `.opts(threadOptions)` (optional)

Builder terminals:

- `.build()` -> `ThreadInstance`
- `.react(triggerEvent, params)`
- `.stream(triggerEvent, params)` (deprecated alias)
- `.register()`
- `.config()`

### `ThreadConfig<Context, Env>`

Required keys:

- `context`
- `narrative`
- `actions` (or legacy `tools`)

Optional keys:

- `expandEvents`
- `model`
- `reactor`
- `shouldContinue`
- `opts`

### `Thread.react`

Primary form:

```ts
thread.react(triggerEvent, {
  env,
  context: { id } | { key } | null,
  options,
})
```

Return shape:

```ts
{
  contextId: string;
  context: StoredContext<Context>;
  triggerEventId: string;
  reactionEventId: string;
  executionId: string;
}
```

### `ThreadStreamOptions`

- `maxIterations?: number` (default `20`)
- `maxModelSteps?: number` (default `1`)
- `preventClose?: boolean` (default `false`)
- `sendFinish?: boolean` (default `true`)
- `silent?: boolean` (default `false`)
- `writable?: WritableStream<UIMessageChunk>`

### `ThreadOptions`

Lifecycle callbacks:

- `onContextCreated`
- `onContextUpdated`
- `onEventCreated`
- `onToolCallExecuted`
- `onEnd`

## Reactor Specification

A reactor receives the full execution context for one iteration and returns normalized assistant output + tool calls.

### `ThreadReactorParams`

- `env`
- `context`
- `contextIdentifier`
- `triggerEvent`
- `model`
- `systemPrompt`
- `actions`
- `toolsForModel`
- `eventId`
- `executionId`
- `contextId`
- `stepId`
- `iteration`
- `maxModelSteps`
- `sendStart`
- `silent`
- `writable`

### `ThreadReactionResult`

- `assistantEvent: ThreadItem`
- `toolCalls: ThreadReactionToolCall[]`
- `messagesForModel: ModelMessage[]`
- `llm?: ThreadReactionLLM`

## Built-in Reactors

## `createAiSdkReactor` (production default)

Uses AI SDK streaming + tool extraction through engine steps.

```ts
import { createAiSdkReactor } from "@ekairos/thread";

const reactor = createAiSdkReactor({
  resolveConfig: async ({ env, context, iteration }) => {
    "use step";
    return {
      model: env.model ?? "openai/gpt-5.2",
      maxModelSteps: iteration === 0 ? 2 : 1,
      tenant: context.content?.orgId,
    };
  },
  selectModel: ({ baseModel, config }) => config.model ?? baseModel,
  selectMaxModelSteps: ({ baseMaxModelSteps, config }) =>
    typeof config.maxModelSteps === "number"
      ? config.maxModelSteps
      : baseMaxModelSteps,
});
```

Use in thread:

```ts
createThread<{ orgId: string }>("support.agent")
  .context((stored, env) => ({ ...stored.content, orgId: env.orgId }))
  .narrative(() => "You are a precise assistant")
  .actions(() => ({}))
  .reactor(reactor)
  .build();
```

## `createScriptedReactor` (testing and deterministic local loops)

No network/model calls. Returns scripted payloads per iteration.

```ts
import { createScriptedReactor } from "@ekairos/thread";

const reactor = createScriptedReactor({
  steps: [
    {
      assistantEvent: {
        content: { parts: [{ type: "text", text: "Deterministic answer" }] },
      },
      toolCalls: [],
      messagesForModel: [],
    },
  ],
  repeatLast: true,
});
```

Rules:

- `steps` must contain at least 1 entry.
- If all steps are consumed and `repeatLast !== true`, reactor throws.
- `assistantEvent` is normalized with fallback fields:
  - `id = params.eventId`
  - `type = "output_text"`
  - `channel = triggerEvent.channel`
  - `createdAt = now`

## Production Pattern

```ts
import { createThread, createAiSdkReactor } from "@ekairos/thread";
import { tool } from "ai";
import { z } from "zod";

type Env = { orgId: string; sessionId: string };

export const supportThread = createThread<Env>("support.agent")
  .context((stored, env) => ({
    orgId: env.orgId,
    sessionId: env.sessionId,
    ...stored.content,
  }))
  .narrative((context) => `Assist session ${context.content?.sessionId}`)
  .actions(() => ({
    ping: tool({
      description: "Health check",
      inputSchema: z.object({ text: z.string().optional() }),
      execute: async ({ text }) => ({ pong: text ?? "ok" }),
    }),
  }))
  .reactor(createAiSdkReactor())
  .shouldContinue(({ reactionEvent }) => {
    const parts = reactionEvent.content?.parts ?? [];
    const hasTool = parts.some((part: any) => part?.type === "tool-call");
    return hasTool;
  })
  .build();
```

## Testing Pattern

```ts
import { createThread, createScriptedReactor } from "@ekairos/thread";

type Env = { orgId: string };

const testThread = createThread<Env>("thread.test")
  .context((stored, env) => ({ orgId: env.orgId, ...stored.content }))
  .narrative(() => "Test narrative")
  .actions(() => ({}))
  .reactor(
    createScriptedReactor({
      steps: [
        {
          assistantEvent: {
            content: { parts: [{ type: "text", text: "ok-1" }] },
          },
          toolCalls: [],
          messagesForModel: [],
        },
      ],
      repeatLast: true,
    }),
  )
  .build();
```

## Stream Contract

Thread stream events (`thread.stream.ts`) are entity-based.

Hierarchy:

1. context
2. thread
3. item
4. step
5. part
6. chunk

Event types:

- `context.created`
- `context.resolved`
- `context.status.changed`
- `thread.created`
- `thread.resolved`
- `thread.status.changed`
- `execution.created`
- `execution.status.changed`
- `item.created`
- `item.status.changed`
- `step.created`
- `step.status.changed`
- `part.created`
- `part.updated`
- `chunk.emitted`
- `thread.finished`

Chunk types (`THREAD_STREAM_CHUNK_TYPES`):

- `data-context-id`
- `data-context-substate`
- `data-thread-ping`
- `tool-output-available`
- `tool-output-error`
- `finish`

Validation helpers:

- `parseThreadStreamEvent(event)`
- `assertThreadStreamTransitions(event)`
- `validateThreadStreamTimeline(events)`

## Transition Contract

Allowed status transitions are exported as constants and enforced by assertion helpers.

- Thread: `open -> streaming -> (open | closed | failed)`, `failed -> open`
- Context: `open <-> streaming`, `(open | streaming) -> closed`
- Execution: `executing -> (completed | failed)`
- Step: `running -> (completed | failed)`
- Item: `stored -> (pending | completed)`, `pending -> completed`

## Runtime and Schema

- Import schema with `threadDomain` from `@ekairos/thread/schema`
- Store integration defaults to `InstantStore`
- Runtime must be configured via `@ekairos/domain/runtime` in host app

Persisted entities:

- `thread_threads`
- `thread_contexts`
- `thread_items`
- `thread_executions`
- `thread_steps`
- `thread_parts`
- `thread_trace_events`
- `thread_trace_runs`
- `thread_trace_spans`

## Notes for Productive Usage

- Always pass explicit `env`.
- Prefer `context: { key }` for stable continuation and `context: { id }` for deterministic resume.
- Keep IO in workflow steps.
- Use `createScriptedReactor` for deterministic regression tests and component demos.
- Validate stream timelines with `validateThreadStreamTimeline` when consuming SSE externally.
