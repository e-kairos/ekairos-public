# @ekairos/openai-reactor

Codex reactor for `@ekairos/thread`.

This package is Codex-only:
- only `createCodexReactor` is exported,
- no generic OpenAI model reactor is provided here.

## Exports

- `createCodexReactor(options)`  
  Codex App Server reactor for direct Thread execution (no tool indirection).
- `mapCodexChunkType(providerChunkType)`  
  Maps provider chunk types to canonical Thread chunk types.
- `defaultMapCodexChunk(providerChunk)`  
  Default provider-chunk mapper used by the reactor.

## Codex Reactor Example

```ts
import { createThread } from "@ekairos/thread";
import { createCodexReactor } from "@ekairos/openai-reactor";

const reactor = createCodexReactor({
  resolveConfig: async ({ env, contextId }) => {
    "use step";
    return {
      appServerUrl: env.appServerUrl,
      repoPath: env.repoPath,
      threadId: env.threadId,
      mode: "local",
    };
  },
  executeTurn: async ({ config, instruction, writable }) => {
    "use step";
    // call codex app server / stream
    return {
      threadId: config.threadId ?? "thread_1",
      turnId: "turn_1",
      assistantText: "Done.",
      reasoningText: "",
      diff: "",
      toolParts: [],
    };
  },
});

const codingThread = createThread<any>("code.agent")
  .context((stored) => stored.content ?? {})
  .narrative(() => "Ekairos coding thread")
  .actions(() => ({}))
  .reactor(reactor)
  .shouldContinue(() => false)
  .build();
```

## Provider stream -> Thread mapping

For each provider chunk you emit via `emitChunk(providerChunk)`, the reactor writes:

- SSE chunk event: `data-chunk.emitted` with canonical `chunkType` (`chunk.text_delta`, `chunk.action_input_available`, etc.)
- `codex-event` part metadata on the persisted output item:
  - `streamTrace.totalChunks`
  - `streamTrace.chunkTypes`
  - `streamTrace.providerChunkTypes`
  - `streamTrace.chunks[]` (configurable)

Default behavior persists stream trace summary and mapped chunks in the final `codex-event`.

Config options:

- `includeStreamTraceInOutput` (default: `true`)
- `includeRawProviderChunksInOutput` (default: `false`)
- `maxPersistedStreamChunks` (default: `300`)
- `onMappedChunk(chunk, params)` hook for custom telemetry pipelines

## Workflow Compatibility

`resolveConfig` and `executeTurn` should be implemented as workflow-safe step functions when they perform I/O.

## AI SDK generic reactor

`createAiSdkReactor(...)` is provider-agnostic and lives in `@ekairos/thread`.

## TODO

- Continuity across machines should be validated end-to-end with persisted session state.
- Current continuity assumption in local tests is: keep the same `contextId` and reuse the same provider `threadId` between turns.
