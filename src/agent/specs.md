# Agents: Abstract Agent for Pulzar

## Goal
- Provide an abstract `Agent` that encapsulates tool-call loop and streaming for domain agents.

## Scope
- Add `lib/domain/agent/agent.ts` with abstract base.
- Export from `lib/domain/agent/index.ts`.
- No UI changes in this iteration.

## Data Model (Agent domain)
- Entities defined in `lib/domain/agent/schema.ts`:
  - `agent_contexts`: stores agent context payloads and metadata (createdAt, updatedAt, type, data)
  - `agent_threads`: stores conversational threads for agents (createdAt, updatedAt, status, title)
  - `agent_events`: stores agent events/messages (role, channel, createdAt, type, parts)

- Links defined in `lib/domain/agent/schema.ts`:
  - `agentContextsOrganization`: `agent_contexts` → `organizations` (label `organization`)
  - `agentThreadsOrganization`: `agent_threads` → `organizations` (label `organization`)
  - `agentEventsOrganization`: `agent_events` → `organizations` (label `organization`)
  - `agentThreadEvents`: `agent_threads` ↔ `agent_events` (thread has many events)
  - `agentThreadContext`: `agent_threads` ↔ `agent_contexts` (thread belongs to context)

These module schemas are composed into the root `instant.schema.ts` via `buildSchema()` in `lib/domain.ts`.

## Data (InstantDB)
- Reuses `story_threads` and `story_events` from `instant.schema.ts` for threads and events linkage:
```217:233:instant.schema.ts
story_threads: i.entity({
  key: i.string().unique().indexed(),
  createdAt: i.date().indexed(),
  updatedAt: i.date().optional().indexed(),
  status: i.string().optional().indexed(),
}),
story_events: i.entity({
  role: i.string().indexed(),
  channel: i.string().indexed(),
  createdAt: i.date().indexed(),
  type: i.string().optional().indexed(),
  parts: i.any(),
}),
```
Links:
```460:465:instant.schema.ts
storyThreadEvents: {
  forward: { on: "story_threads", has: "many", label: "events" },
  reverse: { on: "story_events", has: "one", label: "thread" },
},
```

## API
- `Agent.stream(threadKey, event)` returns a `createDataStreamResponse` for route handlers to `return`.
- Subclasses must implement `buildSystemPrompt`, `buildTools`, and `initialize`.

## Services
- None added. Base initializes InstantDB admin using env. See `lib/db.ts` for pattern:
```1:11:lib/db.ts
export function getAdminDb() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID as string
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN as string
  if (!appId || !adminToken) {
    throw new Error("InstantDB config missing")
  }
  return init({ appId, adminToken, schema })
}
```

## Security
- Requires `NEXT_PUBLIC_INSTANT_APP_ID` and `INSTANT_APP_ADMIN_TOKEN`.
- Does not expose secrets to the client.

## Observability
- Emits `story_events` with `tool-invocation` parts containing `processing` and `result` states.
- When updating an event after a tool execution, existing `parts` are preserved. Only the `tool-invocation` part matching the `toolCallId` is updated to `state: "result"`; if it does not exist, a new part is appended. This prevents losing prior parts from the same event.

## Acceptance (DoD)
- [x] Base class added.
- [x] Export file added.
- [x] Agent schema (entities, links) added and composed via `lib/domain.ts`.
