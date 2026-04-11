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

## Core Pattern

```ts
import { defineDomainAction, domain, EkairosRuntime } from "@ekairos/domain";
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
}, typeof appDomain> {
  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb(env: { appId?: string; adminToken?: string }) {
    return init({
      appId: env.appId!,
      adminToken: env.adminToken!,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any);
  }
}

export async function runWorkflow() {
  "use workflow";
  const runtime = new AppRuntime({
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
