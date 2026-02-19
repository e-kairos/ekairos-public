# @ekairos/thread

Durable AI threads for production apps.

`@ekairos/thread` gives you an execution model that is:

- workflow-compatible,
- persistence-first,
- traceable by design,
- simple to embed in domain applications.

It is the runtime used by Ekairos coding agents and domain agents.

## Why Thread

Most chat abstractions stop at "messages in, text out".  
Thread models the full lifecycle:

1. Persist trigger event.
2. Create execution.
3. Run model reaction.
4. Persist normalized parts.
5. Execute actions (tools).
6. Persist tool outcomes.
7. Decide continue or end.
8. Emit traces for every durable step.

This design supports long-running, resumable agent runs without losing state.

## Core Concepts

- `Thread`: durable loop orchestrator.
- `Reactor`: pluggable reaction implementation (`AI SDK`, `Codex`, `Claude`, `Cursor`, ...).
- `Thread Key`: stable public identifier (`thread.key`) for continuity.
- `Context`: typed persistent state attached to a thread.
- `Item`: normalized event (`input_text`, `output_text`, etc).
- `Execution`: one run for a trigger/reaction pair.
- `Step`: one loop iteration inside an execution.
- `Part`: normalized content fragment persisted by step.
- `Trace`: machine timeline (`thread.*`, `workflow.*`) for observability.

## Installation

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

## Quick Start

### 1) Configure app runtime once

Thread resolves persistence through runtime.  
Do this once in app bootstrap (`src/ekairos.ts`):

```ts
import "server-only";
import { configureRuntime } from "@ekairos/domain/runtime";
import { getOrgAdminDb } from "@/lib/admin-org-db";
import appDomain from "@/lib/domain";

export const runtimeConfig = configureRuntime({
  runtime: async (env: { orgId: string }) => {
    const db = await getOrgAdminDb(env.orgId, appDomain);
    return { db };
  },
  domain: { domain: appDomain },
});
```

### 2) Define a thread

```ts
import { createThread } from "@ekairos/thread";
import { tool } from "ai";
import { z } from "zod";

type Env = { orgId: string; sessionId: string };
type Ctx = { orgId: string; sessionId: string };

export const helloThread = createThread<Env>("hello.thread")
  .context(async (stored, env) => ({
    orgId: env.orgId,
    sessionId: env.sessionId,
    ...(stored.content ?? {}),
  }))
  .narrative((ctx) => `You are a precise assistant. Session=${ctx.content?.sessionId}`)
  .actions(() => ({
    ping: tool({
      description: "Return pong",
      inputSchema: z.object({ text: z.string().optional() }),
      execute: async ({ text }) => ({ pong: text ?? "ok" }),
    }),
  }))
  .model("openai/gpt-5.2")
  .build();
```

### 2.1) Reactor model (new)

Thread runs through a `reactor`:

- default: `createAiSdkReactor()` (included in `@ekairos/thread`)
- deterministic/local testing: `createScriptedReactor({ steps })`
- optional: custom/provider reactor via `.reactor(...)`

```ts
import { createThread, createAiSdkReactor } from "@ekairos/thread";

const thread = createThread<{ orgId: string }>("my.thread")
  .context((stored, env) => ({ ...(stored.content ?? {}), orgId: env.orgId }))
  .narrative(() => "System prompt")
  .actions(() => ({}))
  .reactor(createAiSdkReactor())
  .build();
```

`createAiSdkReactor` also accepts optional per-turn config hooks:

```ts
import { createAiSdkReactor } from "@ekairos/thread";

const reactor = createAiSdkReactor({
  resolveConfig: async ({ env }) => {
    "use step";
    return { model: env.model ?? "openai/gpt-5.2", maxModelSteps: 2 };
  },
  selectModel: ({ config, baseModel }) => config.model ?? baseModel,
  selectMaxModelSteps: ({ config, baseMaxModelSteps }) =>
    typeof config.maxModelSteps === "number"
      ? config.maxModelSteps
      : baseMaxModelSteps,
});
```

For deterministic tests and local iteration loops without LLM/network calls:

```ts
import { createScriptedReactor } from "@ekairos/thread";

const scripted = createScriptedReactor({
  steps: [
    {
      assistantEvent: {
        content: {
          parts: [{ type: "text", text: "deterministic response" }],
        },
      },
      toolCalls: [],
      messagesForModel: [],
    },
  ],
});
```

Provider reactors live in `packages/reactors/*`:

- `@ekairos/openai-reactor` (`createCodexReactor`)
- `@ekairos/claude-reactor` (scaffold)
- `@ekairos/cursor-reactor` (scaffold)

### 3) Run from a workflow

```ts
import { getWritable } from "workflow";
import type { UIMessageChunk } from "ai";
import type { ThreadItem } from "@ekairos/thread";
import { helloThread } from "./hello.thread";

export async function helloWorkflow(params: {
  env: { orgId: string; sessionId: string };
  triggerEvent: ThreadItem;
  threadKey?: string;
}) {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();
  return await helloThread.react(params.triggerEvent, {
    env: params.env,
    context: params.threadKey ? { key: params.threadKey } : null,
    options: { writable, maxIterations: 2, maxModelSteps: 1 },
  });
}
```

## Thread Lifecycle (Detailed)

For each `react(...)` call:

1. `initializeContext` creates or loads context.
2. `saveTriggerAndCreateExecution` persists trigger and execution.
3. `createThreadStep` starts iteration record.
4. `buildSystemPrompt` and `buildTools` are evaluated.
5. `executeReaction` runs model + tool call planning.
6. `saveThreadPartsStep` persists normalized parts.
7. `saveReactionItem` or `updateItem` updates stable reaction item.
8. Tool executions run and are merged into persisted parts.
9. `shouldContinue(...)` decides next iteration or completion.
10. `completeExecution` closes run status.

All side effects are executed through workflow-safe steps.

## Event and Item Model

Key utilities:

- `createUserItemFromUIMessages(...)`
- `createAssistantItemFromUIMessages(...)`
- `convertItemsToModelMessages(...)`
- `convertModelMessageToItem(...)`
- `didToolExecute(...)`
- `extractToolCallsFromParts(...)`

This keeps a stable internal representation while remaining compatible with UI/model formats.

## Runtime and Persistence

Thread runtime resolves from `@ekairos/domain/runtime` bootstrap.

Default persistence adapter:

- `InstantStore` (`@ekairos/thread/instant`)

Schema:

- `thread_threads`
- `thread_contexts`
- `thread_items`
- `thread_executions`
- `thread_steps`
- `thread_parts`
- `thread_trace_events`
- `thread_trace_runs`
- `thread_trace_spans`

Import domain schema:

```ts
import { threadDomain } from "@ekairos/thread/schema";
```

## Streaming

Thread writes `UIMessageChunk` to workflow writable streams.

Options:

- `writable`: custom stream.
- `silent`: disable stream writes, keep persistence.
- `preventClose`: do not close writer.
- `sendFinish`: control final `finish` chunk.

Namespaced streams are supported using `context:<contextId>`.

## Identity Model

- `thread.key` is the functional continuity id.
- `context.id` is internal state id for typed context persistence.
- A thread can own one or more contexts; default runtime behavior is one active context per thread.

### Open Responses alignment

Thread is protocol-aligned with Open Responses item/event semantics and keeps durable execution
through Workflow.

- Public continuity id should be `thread.key`.
- Context remains internal typed state, but can be exposed as an extension field in thread query APIs.
- Safe extension pattern: include `context` object in thread payload while preserving standard fields.

Example shape for a thread query response:

```json
{
  "object": "conversation",
  "id": "thread-key-or-id",
  "status": "completed",
  "context": {
    "id": "ctx_123",
    "key": "code.agent.session.abc",
    "status": "completed",
    "content": {}
  }
}
```

This extension is additive and does not break Open Responses compatibility.

## Tracing and Observability

Thread emits lifecycle traces by default through step operations.

Typical namespaces:

- `thread.run`
- `thread.context`
- `thread.execution`
- `thread.step`
- `thread.item`
- `thread.part`
- `thread.review`
- `thread.llm`
- `workflow.run`

These traces are intended for local persistence plus optional mirror ingestion to central collectors.

## Registry API

Register and resolve threads by key:

```ts
import { registerThread, getThread } from "@ekairos/thread";
```

Builder convenience:

```ts
const builder = createThread<Env>("my.key").context(...).narrative(...).actions(...);
builder.register();
```

## Preconfigured Codex Thread

Use `@ekairos/thread/codex` to create coding threads with minimal wiring.

```ts
import { createCodexThreadBuilder } from "@ekairos/thread/codex";

const builder = createCodexThreadBuilder({
  key: "code.agent",
  context: async (stored, env) => ({ ...(stored.content ?? {}), ...env }),
  executeCodex: async ({ input, env }) => {
    // Call Codex app server here (usually in a use-step function)
    return {
      threadId: "t_123",
      turnId: "turn_123",
      assistantText: "done",
      reasoningText: "",
      diff: "",
      toolParts: [],
    };
  },
});
```

What it configures for you:

- `codex` action schema,
- default model selection (`openai/gpt-5.2`),
- default continue rule (`stop after codex action executes`),
- default narrative fallback.

For direct Codex runtime (without "tool indirection"), use
`@ekairos/openai-reactor` + `createCodexReactor(...)`.

## MCP and OIDC

Utilities are exposed for protocol integration:

- `@ekairos/thread/mcp`
- `@ekairos/thread/oidc`

Use these from server-side API routes when exposing thread-driven tools via MCP.

## DX Guidelines

- Keep `env` serializable.
- Keep thread definition declarative.
- Put DB/network side effects inside step functions.
- Prefer `context.id` for deterministic resume.
- Use explicit thread keys (`domain.agent.name` format).

## Breaking-Change Policy

Thread prioritizes runtime correctness over implicit compatibility shims.

When behavior conflicts with durability or protocol clarity, explicit configuration is preferred over hidden fallbacks.
