# @ekairos/testing

Testing toolkit for domain-first Ekairos apps.

Goal: keep production runtime contract (`resolveRuntime(domain, env)`) and inject testing concerns only in test execution.

## Core model

- Production requires explicit domain at runtime.
- Tests compose `appDomain + testDomain`.
- Runtime resolution in tests uses the same resolver contract.
- Test schema is never pushed to production apps.

## Explicit test schema composition

Create `tests/instant.schema.ts` in each app:

```ts
import { domain } from "@ekairos/domain";
import { ekairosTestDomain } from "@ekairos/testing/schema";
import appDomain from "@/lib/domain";

export const appTestingDomain = domain("my-app.testing")
  .includes(appDomain)
  .includes(ekairosTestDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

export default appTestingDomain.toInstantSchema();
```

This keeps testing explicit: import real app domain, re-compose for test.

Think of tests as a separate runtime bootstrap:

- do not depend on app `src/runtime.ts`,
- define test schema in `tests/instant.schema.ts`,
- resolve runtime with explicit `domain` per test run.

## Runtime APIs

### `getEkairosRuntime(...)`

Resolve runtime with explicit domain and explicit resolver.

```ts
import { getEkairosRuntime } from "@ekairos/testing/runtime";

const rt = await getEkairosRuntime({
  env: { orgId: "org_test_1" },
  domain: appDomain,
  resolveRuntime: ({ env, domain }) => getAppRuntime({ env, domain }),
});
```

### `getEkairosTestRuntime(...)`

Compose `appDomain + testDomain` and resolve runtime in one call.

```ts
import { getEkairosTestRuntime } from "@ekairos/testing/runtime";

const { runtime, domain } = await getEkairosTestRuntime({
  env: { orgId: "org_test_1" },
  appDomain,
  resolveRuntime: ({ env, domain }) => getAppRuntime({ env, domain }),
});
```

### `configureTestRuntime(...)`

Install a global test runtime resolver for suites that call `resolveRuntime(domain, env)` directly.

```ts
import { configureTestRuntime } from "@ekairos/testing/runtime";

beforeAll(() => {
  configureTestRuntime({
    resolveRuntime: ({ env, domain }) => getAppRuntime({ env, domain }),
  });
});
```

Behavior:

- injects `ekairosTestDomain` by default,
- can be customized with `testDomain`, `composeDomain`, `shouldInject`,
- keeps domain explicit per call.

## Provision APIs

`@ekairos/testing/provision`:

- `createTestApp({ name, token, schema?, perms?, orgId? })`
- `pushTestSchema({ appId, token, schema })`
- `pushTestPerms({ appId, token, perms })`
- `destroyTestApp({ appId, token })`

Uses Instant Platform API directly.

Typical flow:

1. `createTestApp(...)` for an ephemeral app.
2. `pushTestSchema(...)` with composed testing schema.
3. run vitest/playwright against that app runtime.
4. optional `destroyTestApp(...)`.

No Clerk wiring is required for this flow unless your tests explicitly validate Clerk behavior.

## Test domain entities

`ekairosTestDomain` includes:

- `test_runs`
- `test_cases`
- `test_events`
- `test_artifacts`
- `test_code_refs`

These hold run evidence (timeline, images, attachments, code links) without contaminating production domain schema.

## Reporter integration

Playwright:

```ts
export default defineConfig({
  reporter: [["list"], ["@ekairos/testing/playwright"]],
});
```

Vitest:

```ts
import { ekairosVitestReporter } from "@ekairos/testing/vitest";

export default defineConfig({
  test: {
    reporters: ["default", ekairosVitestReporter()],
  },
});
```
