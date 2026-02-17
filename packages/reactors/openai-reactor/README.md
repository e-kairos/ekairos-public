# @ekairos/openai-reactor

OpenAI-oriented reactors for `@ekairos/thread`.

## Exports

- `createOpenAIReactor(options?)`  
  Returns the AI SDK reactor (`streamText`) for Thread. Optional `options`
  let you resolve per-turn `config` and map it into model/max-step settings.
- `createCodexReactor(options)`  
  Codex App Server reactor for direct Thread execution (no tool indirection).

## AI SDK Reactor Example

```ts
import { createThread } from "@ekairos/thread";
import { createOpenAIReactor } from "@ekairos/openai-reactor";

const reactor = createOpenAIReactor({
  resolveConfig: async ({ env }) => {
    "use step";
    return {
      model: env.model ?? "openai/gpt-5.2",
      maxModelSteps: 2,
    };
  },
  selectModel: ({ config, baseModel }) => config.model ?? baseModel,
  selectMaxModelSteps: ({ config, baseMaxModelSteps }) =>
    typeof config.maxModelSteps === "number"
      ? config.maxModelSteps
      : baseMaxModelSteps,
});

const aiThread = createThread<any>("ai.thread")
  .context((stored) => stored.content ?? {})
  .narrative(() => "General purpose AI thread")
  .actions(() => ({}))
  .reactor(reactor)
  .shouldContinue(() => false)
  .build();
```

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
