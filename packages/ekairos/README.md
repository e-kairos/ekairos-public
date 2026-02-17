# ekairos

Unified entrypoint for Ekairos core libraries.

`ekairos` re-exports:

- `@ekairos/domain`
- `@ekairos/thread`

Use this package when you want one dependency and a clean DX surface for app teams.

## What You Build With It

Ekairos is for domain-native AI applications:

- model your business as domains,
- run durable AI threads on top of those domains,
- keep state, traces, and workflow execution aligned.

## Installation

```bash
pnpm add ekairos
```

## Minimal App Bootstrap

```ts
import "server-only";
import { configureRuntime } from "ekairos/runtime";
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

The runtime bootstrap is single-source:

- no per-thread runtime bootstrap,
- no duplicated store wiring in app code,
- no extra SDK wrapper required.

Thread builds its store from the runtime-resolved db.

## Define a Thread

```ts
import { createThread } from "ekairos";
import { tool } from "ai";
import { z } from "zod";

const demoThread = createThread<{ orgId: string; sessionId: string }>("demo")
  .context(async (stored, env) => ({ ...(stored.content ?? {}), ...env }))
  .narrative(() => "You are a reliable assistant.")
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

## Preconfigured Coding Thread (`thread/codex`)

If your app uses Codex App Server:

```ts
import { createCodexThreadBuilder } from "ekairos/thread";

const codingBuilder = createCodexThreadBuilder({
  key: "code.agent",
  context: async (stored, env) => ({ ...(stored.content ?? {}), ...env }),
  executeCodex: async ({ input, env }) => {
    // call app server and return normalized output
    return {
      threadId: "t_1",
      turnId: "turn_1",
      assistantText: "completed",
      reasoningText: "",
      diff: "",
      toolParts: [],
    };
  },
});
```

## Workflow Integration

Ekairos threads are designed to run inside Workflow DevKit:

- thread logic stays declarative,
- side effects run in workflow-safe steps,
- streams are resumable via workflow run streams.

Important boundary:

- workflow wrapper owns `"use workflow"`,
- thread engine stays workflow-compatible but does not declare `"use workflow"` internally.

## Package Surface

- `ekairos` -> root re-exports (`domain` + `thread` APIs)
- `ekairos/domain` -> domain constructors and types
- `ekairos/thread` -> thread runtime and builders
- `ekairos/dataset` -> dataset tools (separate package support)

## DX Principles

- Keep startup config short.
- Keep thread definitions easy to read.
- Keep runtime explicit and deterministic.
- Keep domain as source of truth.

This package is optimized for fast onboarding without sacrificing production durability.
