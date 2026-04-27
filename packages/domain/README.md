# @ekairos/domain

Build one app graph from many bounded contexts.
Read it through InstantDB.
Write through step-safe domain actions.
Operate it through a CLI.

## What you get

- Composed domain graphs with `domain(...).withSchema(...)`
- Explicit runtimes with `EkairosRuntime`
- Step-safe write boundaries with `defineAction(...)`
- Workflow-ready action execution with `executeRuntimeAction(...)`
- A companion CLI through `@ekairos/cli` for `create-app`, `inspect`, `action`, and `query`

## Start Fast

Scaffold a Next app that already exposes the Ekairos domain endpoint:

```bash
ekairos create-app my-app --next
```

Run the full supply-chain demo cycle:

```bash
ekairos create-app --demo
```

If you already have an Instant platform token, provision the app and write `.env.local` in one pass:

```bash
ekairos create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

Then run it and inspect it:

```bash
ekairos domain inspect --baseUrl=http://localhost:3000 --admin --pretty
ekairos domain "supplyChain.order.launch" "{ reference: 'PO-7842', supplierName: 'Marula Components', sku: 'DRV-2048' }" --baseUrl=http://localhost:3000 --admin --pretty
ekairos domain query "{ procurement_order: { supplier: {}, stockItems: {}, shipments: { inspections: {} } } }" --baseUrl=http://localhost:3000 --admin --pretty
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
import { defineAction, domain } from "@ekairos/domain";
import { EkairosRuntime } from "@ekairos/domain/runtime-handle";
import { executeRuntimeAction } from "@ekairos/domain/runtime";
import { init } from "@instantdb/admin";
import { i } from "@instantdb/core";

const baseDomain = domain("tasks").withSchema({
  entities: {
    tasks: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

export const createTaskAction = defineAction({
  name: "tasks.create",
  async execute({ runtime, input }) {
    "use step";
    const scoped = await runtime.use(appDomain);
    // transact...
    return { ok: true };
  },
});

export const appDomain = baseDomain.withActions({
  createTask: createTaskAction,
});

// Raw definitions stay available for reflection and adapters:
appDomain.actions.createTask;

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
export const sandboxDomain = domain("sandbox").withSchema({
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
  .withSchema({
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
  .withActions({
    runCommand: defineAction({
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
  .withSchema({ entities: {}, links: {}, rooms: {} });

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
ekairos domain query "{ tasks: { $: { limit: 5 } } }" --admin
ekairos domain query @query.json5 --admin
cat query.json5 | ekairos domain query - --admin
```

Add `--meta` when you need to know whether a query used the local client runtime path or the server route.

## Tests

```bash
pnpm --filter @ekairos/domain test
pnpm --filter @ekairos/domain test:cli
pnpm --filter @ekairos/domain test:workflow
```

## Type And DX Notes

`@ekairos/domain` intentionally encapsulates InstantDB at the domain boundary, but
the schema returned by a domain must remain usable anywhere an InstantDB schema is
expected.

Use `instantSchema()` when provisioning or passing a runtime schema to InstantDB:

```ts
const db = init({
  appId,
  adminToken,
  schema: appDomain.instantSchema(),
});
```

Use `DomainInstantSchema<typeof domain>` when you need the schema type for
`db.query`, `InstaQLParams`, `InstaQLResult`, or service constructors:

```ts
import type { DomainInstantSchema } from "@ekairos/domain";
import type { InstantAdminDatabase } from "@instantdb/admin";

type AppSchema = DomainInstantSchema<typeof appDomain>;

function createService(db: InstantAdminDatabase<AppSchema, true>) {
  return db.query({
    tasks: {
      owner: {},
    },
  });
}
```

Prefer exported domain values without widening their type:

```ts
export const tasksDomain = domain("tasks").withSchema({
  entities: { tasks: i.entity({ title: i.string() }) },
  links: {},
  rooms: {},
});
```

Avoid annotating exported domains as plain `DomainSchemaResult` unless you need to
hide their concrete shape. That annotation widens the domain name and schema, so
TypeScript loses some compile-time checks for `runtime.use(...)`, `RuntimeForDomain`,
and composed queries.

```ts
// Avoid for runtime/domain composition:
export const tasksDomain: DomainSchemaResult = domain("tasks").withSchema(...);
```

Type tests under `src/__type_tests__` are intentionally split by use case:

- `domain.schema-*.typecheck.ts`: schema extraction, entity/link visibility, and query shape.
- `domain.includes-*.typecheck.ts`: composed entities, transitive links, and traversal direction.
- `domain.instaql-fetch.typecheck.ts`: namespaces, associations, deferred query shapes, and `queryOnce`.
- `domain.instaql-filters.typecheck.ts`: dotted relation filters and advanced where operators.
- `domain.instaql-options.typecheck.ts`: pagination, ordering, selected fields, and page info.
- `domain.instantdb-*.typecheck.ts`: InstantDB query, entity, and result helpers.
- `domain.query-negative-*.typecheck.ts`: invalid entities and relation labels stay rejected.
- `domain.dx-*.typecheck.ts`: public helper aliases, literal names, and schema helpers.
- `runtime.domain-names-*.typecheck.ts`: `RuntimeForDomain` validates name plus schema.
- `workflow-output-*.typecheck.ts`: workflow serde output contracts.

When a type regression appears, add one small file or one focused case to the
matching file. Avoid broad "kitchen sink" type tests; they make IntelliSense and
compiler failures hard to read.

