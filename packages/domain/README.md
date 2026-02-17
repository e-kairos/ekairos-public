# @ekairos/domain

[![npm version](https://img.shields.io/npm/v/@ekairos/domain)](https://www.npmjs.com/package/@ekairos/domain)
[![npm downloads](https://img.shields.io/npm/dm/@ekairos/domain)](https://www.npmjs.com/package/@ekairos/domain)

Domain-first TypeScript primitives for InstantDB applications.

`@ekairos/domain` gives you one source of truth for:

- Schema composition.
- Runtime resolution.
- Typed domain actions.
- AI-ready domain context.

If `@ekairos/thread` is execution, `@ekairos/domain` is system truth.

## Install

```bash
pnpm add @ekairos/domain @instantdb/core
pnpm add -D @instantdb/admin
```

Exports:

- `@ekairos/domain`
- `@ekairos/domain/runtime`
- `@ekairos/domain/next`

## Quick start

### 1. Define a domain schema

```ts
import { domain } from "@ekairos/domain";
import { i } from "@instantdb/core";

export const managementDomain = domain("management").schema({
  entities: {
    management_tasks: i.entity({
      title: i.string(),
      status: i.string().indexed(),
      createdAt: i.date().indexed(),
    }),
  },
  links: {},
  rooms: {},
});
```

### 2. Add typed actions

```ts
import { defineDomainAction } from "@ekairos/domain";

const createTask = defineDomainAction<
  { orgId: string; actorId: string },
  { title: string },
  { ok: true; taskId: string },
  { db: any }
>({
  name: "management.task.create",
  description: "Create a management task",
  async execute({ env, input, runtime }) {
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("title_required");

    // use runtime.db here
    return { ok: true, taskId: `task_${env.orgId}` };
  },
});

export const appDomain = managementDomain.actions([createTask]);
```

### 3. Configure runtime once

```ts
import { configureRuntime } from "@ekairos/domain/runtime";
import { appDomain } from "./domain";

configureRuntime({
  domain: { domain: appDomain },
  runtime: async (env) => {
    // Resolve DB by env (org, actor, tenant, etc.)
    return { db: { orgId: env.orgId } };
  },
});
```

### 4. Execute actions

```ts
import { executeRuntimeAction } from "@ekairos/domain/runtime";

const output = await executeRuntimeAction({
  action: "management.task.create",
  env: { orgId: "org_123", actorId: "user_1" },
  input: { title: "Ship domain action runtime" },
});
```

## Action model

Actions are explicit and portable:

- Domain package owns contracts.
- Adapters own environment (`env`).
- Runtime is resolved per action domain.
- Nested action calls are supported with cycle protection.

This keeps Web/API/MCP integrations aligned without duplicating mutation logic.

## Domain context for AI

Every domain can produce structured context:

- `domain.context()` returns a machine-friendly context object.
- `domain.contextString()` returns a prompt-friendly string.

Use this to ground coding agents and domain assistants with current entities, links, docs, and subdomains.

## Adapter pattern (recommended)

### Web/API

- UI calls API route.
- API route resolves auth and builds `env`.
- API route executes typed domain action.

### MCP

- Expose one MCP tool per action (or a thin action dispatcher).
- Resolve transport auth to `env`.
- Execute the same domain actions used by Web/API.

## Design rules

- Domain defines truth.
- Runtime is explicit.
- Actions are explicit.
- `env` is adapter-defined and opaque to the package.
- Included subdomains do not auto-export actions.

## Testing

```bash
pnpm run test:unit   # runtime and action behavior
pnpm run test:e2e    # InstantDB temp app flow (requires INSTANT_CLI_AUTH_TOKEN)
```

## Links

- npm: https://www.npmjs.com/package/@ekairos/domain
- source: https://github.com/e-kairos/ekairos-public/tree/main/packages/domain
- issues: https://github.com/e-kairos/ekairos-public/issues

## License

MIT