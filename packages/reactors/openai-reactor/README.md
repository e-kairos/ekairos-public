# @ekairos/openai-reactor

Codex reactor for `@ekairos/thread`.

## Exports

- `createCodexReactor(options)`  
  Codex App Server reactor for direct Thread execution (no tool indirection).

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

## Workflow Compatibility

`resolveConfig` and `executeTurn` should be implemented as workflow-safe step functions when they perform I/O.

## AI SDK generic reactor

`createAiSdkReactor(...)` is provider-agnostic and lives in `@ekairos/thread`.
