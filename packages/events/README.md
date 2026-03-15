# @ekairos/events

Context-first durable execution runtime for Ekairos.

## Surface

- `createContext`, `context`, `ContextEngine`
- `createAiSdkReactor`, `createScriptedReactor`
- `useContext`
- `eventsDomain`
- `getContextRuntime`, `getContextEnv`, `registerContextEnv`

## Runtime model

- `event_contexts`
- `event_items`
- `event_executions`
- `event_steps`
- `event_parts`
- `event_trace_events`
- `event_trace_runs`
- `event_trace_spans`

The aggregate is `context`. Executions, steps, parts, and items are scoped to a context.

## Install

```bash
pnpm add @ekairos/events
```

## Example

```ts
import { createContext, createAiSdkReactor } from "@ekairos/events";

type Env = { orgId: string };

export const supportContext = createContext<Env>("support.agent")
  .context((stored, env) => ({
    orgId: env.orgId,
    ...stored.content,
  }))
  .narrative(() => "You are a precise assistant.")
  .actions(() => ({}))
  .reactor(createAiSdkReactor())
  .build();
```

## Notes

- Public continuity is context-based.
- Provider-specific IDs such as `providerContextId` may still exist when an upstream provider requires them.
- Runtime wiring for stores lives under `@ekairos/events/runtime`.
