# @ekairos/events

Context-first durable execution runtime for Ekairos.

## What this package does

- creates durable contexts with `createContext(...)`
- persists executions, steps, parts, and items
- runs direct or durable `react(...)` loops
- adapts model/tool output into canonical `event_parts`

## Main APIs

- `createContext`
- `ContextEngine`
- `createAiSdkReactor`
- `createScriptedReactor`
- `runContextReactionDirect`
- `eventsDomain`

## Runtime model

Canonical entities:

- `event_contexts`
- `event_items`
- `event_executions`
- `event_steps`
- `event_parts`
- `event_trace_*`

`event_parts` is the source of truth for replay.

## Example

```ts
import { createContext } from "@ekairos/events";

const supportContext = createContext<{ orgId: string }>("support.agent")
  .context((stored, env) => ({
    ...stored.content,
    orgId: env.orgId,
  }))
  .narrative(() => "You are a precise assistant.")
  .actions(() => ({}))
  .build();
```

Run directly:

```ts
const shell = await supportContext.react(triggerEvent, {
  runtime,
  context: { key: "support:org_123" },
  durable: false,
});

const final = await shell.run!;
```

Run durably:

```ts
const shell = await supportContext.react(triggerEvent, {
  runtime,
  context: { key: "support:org_123" },
});

const final = await shell.run!.returnValue;
```

## Tool execution model

Context tools now receive runtime-aware execution context.
That lets a tool do this inside `"use step"`:

```ts
async function execute(input, ctx) {
  "use step";
  const domain = await ctx.runtime.use(myDomain);
  return await domain.actions.doSomething(input);
}
```

## Tests

```bash
pnpm --filter @ekairos/events test
pnpm --filter @ekairos/events test:workflow
```
