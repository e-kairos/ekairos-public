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

## Canonical Parts

`event_parts` is the canonical content model for produced output.

Rules:

- `event_parts.part` is the source of truth for replay and inspection.
- `event_items.content.parts` on output items is maintained as a compatibility mirror and is deprecated as a replay source.
- Provider/model-specific values must live under `metadata`, never as first-class semantic fields.

Canonical part kinds:

- `content`
- `reasoning`
- `source`
- `tool-call`
- `tool-result`

Each canonical part stores a `content` array. The entries inside that array define the payload type:

- `text`
- `file`
- `json`
- `source-url`
- `source-document`

Example tool result:

```ts
{
  type: "tool-result",
  toolCallId: "call_123",
  toolName: "inspectCanvasRegion",
  state: "output-available",
  content: [
    {
      type: "text",
      text: "Zoomed crop of the requested region.",
    },
    {
      type: "file",
      mediaType: "image/png",
      filename: "inspect-region.png",
      data: "iVBORw0KGgoAAAANSUhEUgAA...",
    },
  ],
  metadata: {
    provider: {
      itemId: "fc_041cb...",
    },
  },
}
```

The AI SDK bridge projects canonical parts to:

- assistant messages with text/file/reasoning/source/tool-call parts
- tool messages with `tool-result` or `tool-error`

That means multipart tool outputs are replayed from `event_parts` instead of relying on the deprecated output-item mirror.

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
