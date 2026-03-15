# @ekairos/openai-reactor

Codex reactor for `@ekairos/events`.

This package is Codex-only:
- only `createCodexReactor` is exported,
- no generic OpenAI model reactor is provided here.

## Exports

- `createCodexReactor(options)`  
  Codex App Server reactor for direct Context execution (no tool indirection).
- `mapCodexChunkType(providerChunkType)`  
  Maps provider chunk types to canonical Context chunk types.
- `defaultMapCodexChunk(providerChunk)`  
  Default provider-chunk mapper used by the reactor.

## Codex Reactor Example

```ts
import { createContext } from "@ekairos/events";
import { createCodexReactor } from "@ekairos/openai-reactor";

const reactor = createCodexReactor({
  resolveConfig: async ({ env, contextId }) => {
    "use step";
    return {
      appServerUrl: env.appServerUrl,
      repoPath: env.repoPath,
      providerContextId: env.providerContextId,
      mode: "local",
    };
  },
  executeTurn: async ({ config, instruction, writable }) => {
    "use step";
    // call codex app server / stream
    return {
      providerContextId: config.providerContextId ?? "context_1",
      turnId: "turn_1",
      assistantText: "Done.",
      reasoningText: "",
      diff: "",
      toolParts: [],
    };
  },
});

const codingContext = createContext<any>("code.agent")
  .context((stored) => stored.content ?? {})
  .narrative(() => "Ekairos coding context")
  .actions(() => ({}))
  .reactor(reactor)
  .shouldContinue(() => false)
  .build();
```

## Provider stream -> Context mapping

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

`createAiSdkReactor(...)` is provider-agnostic and lives in `@ekairos/events`.

## TODO

- Continuity across machines should be validated end-to-end with persisted session state.
- Current continuity assumption in local tests is: keep the same `contextId` and reuse the same provider `providerContextId` between turns.
