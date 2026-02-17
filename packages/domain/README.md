# @ekairos/domain

Domain-first foundation for Ekairos applications.

`@ekairos/domain` is the canonical primitive for:

1. schema composition,
2. runtime resolution,
3. domain context for AI,
4. domain actions (typed mutations/commands).

If `@ekairos/thread` is execution, `@ekairos/domain` is system truth.

## Core idea

A domain is no longer only `toInstantSchema()`.  
A domain is:

- structural contract (entities, links, rooms),
- execution contract (runtime),
- mutation contract (actions).

This keeps web, MCP, and internal APIs aligned to one domain interface.

## Install

```bash
pnpm add @ekairos/domain
```

Exports:

- `@ekairos/domain`
- `@ekairos/domain/runtime`
- `@ekairos/domain/next`

## Quick start

### 1) Define schema

```ts
import { domain } from "@ekairos/domain";
import { i } from "@instantdb/core";

const managementSchema = domain("management")
  .schema({
    entities: {
      management_tasks: i.entity({
        title: i.string(),
        status: i.string().indexed(),
        createdAt: i.date().indexed(),
        updatedAt: i.date().optional(),
      }),
    },
    links: {},
    rooms: {},
  });
```

### 2) Attach domain actions

```ts
import { defineDomainAction } from "@ekairos/domain";

const managementDomain = managementSchema.actions({
  "management.task.create": defineDomainAction({
    description: "Create a management task",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    },
    requiredScopes: ["management.task.write"],
    async execute({ env, input, runtime }) {
      // env is adapter-defined and opaque here.
      // runtime is domain-bound runtime for this domain.
      const title = String(input?.title ?? "").trim();
      if (!title) throw new Error("title_required");
      // mutate runtime.db...
      return { ok: true };
    },
  }),
});
```

Key rules:

1. Actions are explicit (`.actions(...)`).
2. Included subdomains do not auto-export actions to parent domains.
3. Action naming should be stable and namespaced (example: `management.task.update`).

## Action model (env-first)

`@ekairos/domain` does not assume `orgId`, Clerk, tenant, or provider.

Actions receive:

- `env`: adapter-owned execution environment (opaque in domain package),
- `input`: typed action input,
- `runtime`: resolved runtime for the action domain,
- `call`: helper for nested explicit actions.

Type surface:

```ts
type DomainActionExecuteParams<Env, Input, Runtime> = {
  env: Env;
  input: Input;
  runtime: Runtime;
  call: <NestedInput, NestedOutput>(action, input) => Promise<NestedOutput>;
};
```

## Runtime configuration

Use `configureRuntime` once in app bootstrap:

```ts
import { configureRuntime } from "@ekairos/domain/runtime";
import appDomain from "./domain";

export const runtimeConfig = configureRuntime({
  domain: {
    domain: appDomain,
    // optional explicit actions in addition to domain.actions()
    actions: [],
  },
  runtime: async (env) => {
    // resolve db by env
    return { db: /* ... */ };
  },
});
```

## Runtime action APIs

From `@ekairos/domain/runtime`:

- `getRuntimeActions()`
- `getRuntimeAction(name)`
- `executeRuntimeAction({ action, env, input })`

`executeRuntimeAction` guarantees:

1. runtime resolved from action domain,
2. env propagated as-is,
3. nested `call(...)` support,
4. cycle protection for recursive action chains.

## Adapter pattern (recommended)

### Web/API adapter

1. UI calls API route.
2. API route resolves auth and builds `env`.
3. API route imports typed action and executes it directly.

No string dispatcher required in web routes.

### MCP adapter

MCP can expose one tool per action (by name).  
At transport boundary, string-to-action resolution is acceptable.

Recommended MCP tools:

1. `domain.query`
2. `domain.actions.list`
3. each registered action (example: `management.task.update`)

## Domain composition and action boundaries

Schema composition uses `.includes(...)`.

Action composition is explicit:

1. parent domain does not inherit child actions automatically,
2. parent can call child actions explicitly via `call(...)` or direct imports,
3. this avoids accidental action surface inflation.

## Next.js integration

Use `withRuntime(...)` in Next config to ensure runtime bootstrap in server bundles and generated `.well-known` routes.

## Design principles

1. Domain first.
2. Runtime explicit.
3. Actions explicit.
4. Env opaque and adapter-defined.
5. No implicit cross-domain mutation surfaces.

## Migration notes

If you already use `domain(...).schema(...)`:

1. no breaking change required,
2. incrementally add `.actions(...)`,
3. move mutable business logic from routes/services into domain actions,
4. keep adapters thin.

## Why this matters for AI

With domain actions:

1. AI tools mutate through typed contracts,
2. web/API/MCP share one mutation semantics,
3. schema and mutation drift are reduced,
4. runtime isolation stays explicit and auditable.
