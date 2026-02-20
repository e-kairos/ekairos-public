# Ekairos Thread Specification

Status: Draft
Version: 1.0.0-draft
Scope: `@ekairos/thread` runtime, data model, lifecycle, streaming, and compatibility profile
Last Updated: 2026-02-20

## 1. Purpose

This specification defines the normative contract for Ekairos Thread.

Thread is a durable orchestration layer for conversational and agentic execution. It is semantically compatible with Open Responses for item/message meaning, and extends that model with durable execution state, typed context, steps, parts, and traces.

Thread is intentionally above a plain responses API:
1. It preserves Open Responses item semantics.
2. It adds deterministic execution semantics suitable for durable workflows.
3. It standardizes persistence and streaming contracts for production systems.

## 2. Conformance Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as described in RFC 2119.

## 3. Relationship to Open Responses

### 3.1 Semantic Compatibility

Thread adopts Open Responses semantics for conversational items:
1. Message semantics and content part semantics.
2. Message roles.
3. Content part meaning (`input_text`, `output_text`, and related parts).

Thread item categories are intentionally opinionated:
1. `message`
2. `action_execute`
3. `action_result`
4. `item_reference`

Interoperability with Open Responses requires explicit transforms:
1. `action_execute` <-> `function_call`
2. `action_result` <-> `function_call_output`

### 3.2 Thread Extensions

Thread introduces additional first-class runtime entities:
1. `thread`
2. `context`
3. `execution`
4. `step`
5. `part`
6. `trace`

These extensions do not alter the meaning of Open Responses items; they provide durable orchestration and observability boundaries.

## 4. Canonical Data Model

This section defines the canonical contract that new Thread clients SHOULD target.

### 4.1 Thread Object

```ts
type ThreadStatus = "open" | "streaming" | "closed" | "failed"

type Thread = {
  id: string
  key: string | null
  status: ThreadStatus
  createdAt: string
  updatedAt?: string
}
```

Rules:
1. `thread.key` is the stable public continuity identifier and SHOULD be used by clients.
2. `thread.id` is internal and MAY be used by storage internals.

### 4.2 Context Object

```ts
type ContextStatus = "open" | "streaming" | "closed"

type Context<C = unknown> = {
  id: string
  key: string | null
  threadId: string
  status: ContextStatus
  content: C | null
  createdAt: string
  updatedAt?: string
}
```

Rules:
1. Context is typed persistent state attached to a thread.
2. Context is an extension surface; it is not an Open Responses base object.

### 4.3 Item Object (Canonical)

```ts
type ItemType =
  | "message"
  | "action_execute"
  | "action_result"
  | "item_reference"

type MessageRole = "user" | "assistant" | "system" | "developer"

type Item = {
  id: string
  type: ItemType
  createdAt: string
  status?: "stored" | "pending" | "completed"
  channel?: "web" | "whatsapp" | "email"
  content?: unknown
}
```

For `type = "message"`:

```ts
type MessageItem = Item & {
  type: "message"
  role: MessageRole
  content: MessagePart[]
}
```

### 4.4 Message Parts (Canonical)

Thread message parts follow Open Responses semantics.

Minimum part set that implementations MUST support:
1. `input_text`
2. `output_text`
3. `reasoning`

Recommended part set:
1. `input_image`
2. `input_file`
3. `refusal`
4. tool call parts (provider-specific, normalized by reactor)

Example:

```json
{
  "id": "itm_user_01",
  "type": "message",
  "role": "user",
  "createdAt": "2026-02-20T10:00:00.000Z",
  "content": [
    { "type": "input_text", "text": "Summarize this repo." }
  ]
}
```

### 4.5 Execution Object

```ts
type ExecutionStatus = "executing" | "completed" | "failed"

type Execution = {
  id: string
  threadId: string
  contextId: string
  triggerItemId: string
  reactionItemId: string
  workflowRunId?: string
  status: ExecutionStatus
  createdAt: string
  updatedAt?: string
}
```

### 4.6 Step Object

```ts
type StepStatus = "running" | "completed" | "failed"

type Step = {
  id: string
  executionId: string
  iteration: number
  status: StepStatus
  eventId: string
  toolCalls?: unknown
  toolExecutionResults?: unknown
  continueLoop?: boolean
  errorText?: string
  createdAt: string
  updatedAt?: string
}
```

### 4.7 Part Object

```ts
type Part = {
  key: string // "${stepId}:${idx}"
  stepId: string
  idx: number
  type?: string
  part?: unknown
  updatedAt?: string
}
```

Rules:
1. `part.key` MUST equal `${stepId}:${idx}`.
2. Parts are the normalized per-step source of truth.
3. Item-embedded parts MAY exist for compatibility and transport.

## 5. State Machines

### 5.1 Thread Status Transitions

Allowed transitions:
1. `open -> streaming`
2. `streaming -> open`
3. `streaming -> closed`
4. `streaming -> failed`
5. `failed -> open`

### 5.2 Context Status Transitions

Allowed transitions:
1. `open -> streaming`
2. `streaming -> open`
3. `open -> closed`
4. `streaming -> closed`

### 5.3 Execution Status Transitions

Allowed transitions:
1. `executing -> completed`
2. `executing -> failed`

### 5.4 Step Status Transitions

Allowed transitions:
1. `running -> completed`
2. `running -> failed`

### 5.5 Item Status Transitions

Allowed transitions:
1. `stored -> pending`
2. `stored -> completed`
3. `pending -> completed`

## 6. Reactor Contract

A reactor is the pluggable generation/execution unit per step.

Reactor MUST return:
1. `assistantEvent` (Thread item for current reaction boundary).
2. `toolCalls` (normalized list extracted from parts).
3. `messagesForModel` (effective prompt message set).

Reactor SHOULD return:
1. LLM usage metadata (`provider`, `model`, token usage, latency).

Reactor MAY:
1. Produce provider-specific parts if they preserve item semantics.
2. Emit extension parts in namespaced form.

## 7. Lifecycle Contract

For each `thread.react(triggerItem, params)` call, an implementation MUST:
1. Resolve/create context.
2. Persist trigger item.
3. Create execution in `executing`.
4. Create step in `running`.
5. Run reactor and persist step parts.
6. Persist/append reaction item.
7. Execute tool calls and merge results into reaction parts.
8. Update step outcome.
9. Decide continue/end.
10. Finalize reaction item and execution.

Loop control rules:
1. A `message` item does not imply global completion.
2. Continuation/termination MUST be decided by the thread loop policy (`shouldContinue` and execution state).
3. Message metadata MUST NOT be required for loop control.

Determinism rule:
1. External I/O MUST happen in workflow step boundaries.
2. Workflow replay MUST be safe with stable persisted identifiers.

## 8. Streaming Contract

Thread exposes chunk-level stream semantics for UI and clients.

### 8.1 Thread Chunk Types

Supported chunk types:
1. `data-context-id`
2. `data-context-substate`
3. `data-thread-ping`
4. `tool-output-available`
5. `tool-output-error`
6. `finish`

### 8.2 Timeline Event Types (Typed Stream Validation)

Typed timeline events:
1. `context.created`
2. `context.resolved`
3. `context.status.changed`
4. `thread.created`
5. `thread.resolved`
6. `thread.status.changed`
7. `execution.created`
8. `execution.status.changed`
9. `item.created`
10. `item.status.changed`
11. `step.created`
12. `step.status.changed`
13. `part.created`
14. `part.updated`
15. `chunk.emitted`
16. `thread.finished`

Transition events MUST validate against state machines in Section 5.

## 9. Persistence Mapping

Canonical storage entities:
1. `thread_threads`
2. `thread_contexts`
3. `thread_items`
4. `thread_executions`
5. `thread_steps`
6. `thread_parts`
7. `thread_trace_events`
8. `thread_trace_runs`
9. `thread_trace_spans`

Link invariants:
1. Context belongs to exactly one thread.
2. Item belongs to thread and context.
3. Execution belongs to thread and context, and references trigger/reaction items.
4. Step belongs to execution.
5. Part belongs to step.

## 10. Open Responses Interoperability Mapping

Thread is not an alias of Open Responses. It is a stricter execution model.

Required transform mapping when exposing/consuming Open Responses:
1. Thread `message` -> Open Responses `message`.
2. Thread `action_execute` -> Open Responses `function_call`.
3. Thread `action_result` -> Open Responses `function_call_output`.
4. Thread `item_reference` -> Open Responses `item_reference`.

Additional rules:
1. Thread reasoning remains a `message` part (`type: "reasoning"`), not an item.
2. Open Responses `reasoning` items, when received, SHOULD be normalized into message reasoning parts.

## 11. Extension Rules

Thread supports extension parts and metadata.

Rules:
1. Extensions MUST be additive.
2. Extensions SHOULD be namespaced to avoid collisions.
3. Extensions MUST NOT reinterpret canonical item semantics.

Example extension part:
```json
{
  "type": "codex-event",
  "state": "output-available",
  "output": { "threadId": "t1", "turnId": "turn1" }
}
```

## 12. Security and Multi-Tenancy

Thread runtime is environment-scoped.

Rules:
1. Runtime resolution MUST be explicit from caller environment.
2. Multi-tenant systems MUST pass tenant scope explicitly in runtime env.
3. No implicit tenant fallback SHOULD be used in production.

## 13. Versioning and Evolution

Specification versioning follows semantic intent:
1. Major: incompatible contract change.
2. Minor: additive feature/change.
3. Patch: clarifications and non-behavioral corrections.

Change policy:
1. Any contract change MUST update this spec before runtime changes are merged.
2. Tests MUST validate transitions and stream contract against this spec.

## 14. Example End-to-End Canonical Turn

1. Incoming user message item:
```json
{
  "id": "itm_u1",
  "type": "message",
  "role": "user",
  "createdAt": "2026-02-20T12:00:00.000Z",
  "content": [{ "type": "input_text", "text": "Create a project plan." }]
}
```

2. Execution created:
```json
{
  "id": "exe_1",
  "status": "executing",
  "triggerItemId": "itm_u1",
  "reactionItemId": "itm_a1"
}
```

3. Assistant message item progresses:
```json
{
  "id": "itm_a1",
  "type": "message",
  "role": "assistant",
  "status": "pending",
  "content": [
    { "type": "output_text", "text": "I will build the plan in phases." },
    { "type": "tool-plan_writer", "toolCallId": "tc_1", "input": { "scope": "full" } }
  ]
}
```

4. Tool execution merged:
```json
{
  "id": "itm_a1",
  "status": "completed",
  "content": [
    { "type": "output_text", "text": "I will build the plan in phases." },
    {
      "type": "tool-plan_writer",
      "toolCallId": "tc_1",
      "state": "output-available",
      "output": { "ok": true }
    }
  ]
}
```

5. Execution completed, thread/context return to `open`.

## 15. Implementation Notes (Current Codebase)

As of this draft:
1. Runtime and store already implement durable `thread/context/execution/step/part` lifecycle.
2. Streaming contract and transition validation are implemented.
3. Item typing follows the Thread canonical set (`message`, `action_execute`, `action_result`, `item_reference`).

This spec is the source of truth for thread runtime and interoperability transforms.
