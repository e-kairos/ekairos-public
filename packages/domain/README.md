# @ekairos/domain

Build one app graph from many bounded contexts.
Read it through InstantDB.
Write through step-safe domain actions.
Operate it through a CLI.

## What you get

- Composed domain graphs with `domain(...).schema(...)`
- Explicit runtimes with `EkairosRuntime`
- Step-safe write boundaries with `defineDomainAction(...)`
- Workflow-ready action execution with `executeRuntimeAction(...)`
- A built-in CLI for `create-app`, `inspect`, `action`, and `query`

## Start Fast

Scaffold a Next app that already exposes the Ekairos domain endpoint:

```bash
npx @ekairos/domain create-app my-app --next
```

If you already have an Instant platform token, provision the app and write `.env.local` in one pass:

```bash
npx @ekairos/domain create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

Then run it and inspect it:

```bash
npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty
npx @ekairos/domain seedDemo --baseUrl=http://localhost:3000 --admin --pretty
npx @ekairos/domain query "{ app_tasks: { comments: {} } }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Next.js Route

New Next.js apps expose the domain adapter explicitly:

```ts
// src/app/api/ekairos/domain/route.ts
import { createRuntimeRouteHandler } from "@ekairos/domain/next";
import { createRuntime } from "@/runtime";

export const { GET, POST } = createRuntimeRouteHandler({
  createRuntime,
});
```

This replaces the old `withRuntime(...)` pattern.
There is no Next config patching and no generated `.well-known` domain route in new apps.

Your `next.config.ts` should stay focused on Workflow:

```ts
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ekairos/domain"],
};

export default withWorkflow(nextConfig) as NextConfig;
```

The CLI uses `/api/ekairos/domain` by default and falls back to the legacy
`/.well-known/ekairos/v1/domain` endpoint for older apps.

## Core Pattern

```ts
import { defineDomainAction, domain } from "@ekairos/domain";
import { EkairosRuntime } from "@ekairos/domain/runtime-handle";
import { executeRuntimeAction } from "@ekairos/domain/runtime";
import { init } from "@instantdb/admin";
import { i } from "@instantdb/core";

const baseDomain = domain("tasks").schema({
  entities: {
    tasks: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

export const createTaskAction = defineDomainAction({
  name: "tasks.create",
  async execute({ runtime, input }) {
    "use step";
    const scoped = await runtime.use(appDomain);
    // transact...
    return { ok: true };
  },
});

export const appDomain = baseDomain.actions({
  createTask: createTaskAction,
});

export class AppRuntime extends EkairosRuntime<{
  appId?: string;
  adminToken?: string;
}, typeof appDomain, any> {
  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb(env: { appId?: string; adminToken?: string }) {
    return init({
      appId: env.appId!,
      adminToken: env.adminToken!,
      schema: appDomain.instantSchema(),
      useDateObjects: true,
    } as any);
  }
}

export function createRuntime(env = {}) {
  return new AppRuntime(env);
}

export async function runWorkflow() {
  "use workflow";
  const runtime = createRuntime({
    appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID,
    adminToken: process.env.INSTANT_ADMIN_TOKEN,
  });

  return await executeRuntimeAction({
    runtime,
    action: createTaskAction,
    input: { title: "Ship it" },
  });
}
```

## Rules Of Thumb

- Read directly from the composed schema when no invariant is involved.
- Put every meaningful write behind an action.
- Keep action bodies `"use step"`.
- Keep workflow orchestration above actions.
- Use `DOMAIN.md` plus `domain.contextString()` when an AI agent needs the model explained.

## Public And Full Domains

Use normal domain composition to split browser-visible schema from server/runtime
capabilities. The public domain is a smaller domain. The full domain imports and
extends it.

```ts
// @acme/sandbox/public
export const sandboxDomain = domain("sandbox").schema({
  entities: {
    sandbox_sandboxes: i.entity({
      provider: i.string().indexed(),
      status: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
  },
  links: {},
  rooms: {},
});
```

```ts
// @acme/sandbox
import { sandboxDomain as publicSandboxDomain } from "@acme/sandbox/public";

export const sandboxDomain = domain("sandbox")
  .includes(publicSandboxDomain)
  .schema({
    entities: {
      sandbox_processes: i.entity({
        kind: i.string().indexed(),
        status: i.string().indexed(),
        command: i.string(),
        startedAt: i.number().indexed(),
      }),
    },
    links: {
      sandboxProcessSandbox: {
        forward: { on: "sandbox_processes", has: "one", label: "sandbox" },
        reverse: { on: "sandbox_sandboxes", has: "many", label: "processes" },
      },
    },
    rooms: {},
  })
  .actions({
    runCommand: defineDomainAction({
      name: "sandbox.runCommand",
      async execute({ runtime, input }) {
        "use step";
        // server/provider work
      },
    }),
  });
```

Client schema composition imports public domains:

```ts
import { sandboxDomain } from "@acme/sandbox/public";

export const appDomain = domain("app")
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

export default appDomain.instantSchema();
```

Server runtime imports full domains:

```ts
import { sandboxDomain } from "@acme/sandbox";

const sandbox = await runtime.use(sandboxDomain);
await sandbox.actions.runCommand({ sandboxId, command: "pnpm", args: ["test"] });
```

This pattern controls schema visibility only. It is not an authorization model:
configure Instant permissions for actual data access.

## CLI Input Quality Of Life

The CLI accepts JSON5, `@file`, and stdin:

```bash
npx @ekairos/domain query "{ tasks: { $: { limit: 5 } } }" --admin
npx @ekairos/domain query @query.json5 --admin
cat query.json5 | npx @ekairos/domain query - --admin
```

Add `--meta` when you need to know whether a query used the local client runtime path or the server route.

## Tests

```bash
pnpm --filter @ekairos/domain test
pnpm --filter @ekairos/domain test:cli
pnpm --filter @ekairos/domain test:workflow
```

