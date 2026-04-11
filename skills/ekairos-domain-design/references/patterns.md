# Patterns

## Domain

```ts
import { defineDomainAction, domain } from "@ekairos/domain";
import { i } from "@instantdb/core";

const baseDomain = domain("billing").schema({
  entities: {
    billing_invoices: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

export const createInvoiceAction = defineDomainAction({
  name: "billing.invoice.create",
  async execute({ runtime, input }) {
    "use step";
    const scoped = await runtime.use(appDomain);
    // transact...
    return { ok: true };
  },
});

export const appDomain = baseDomain.actions({
  createInvoice: createInvoiceAction,
});
```

## Runtime

```ts
import { init } from "@instantdb/admin";
import { EkairosRuntime } from "@ekairos/domain";
import { configureRuntime } from "@ekairos/domain/runtime";
import appDomain from "./domain";

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

export const runtimeConfig = configureRuntime({
  runtime: async (env) => {
    const runtime = new AppRuntime(env);
    return { db: await runtime.db() };
  },
  domain: { domain: appDomain },
});
```

## Workflow

```ts
import { executeRuntimeAction } from "@ekairos/domain/runtime";
import { createInvoiceAction } from "../domain";
import { createRuntime } from "../runtime";

export async function runBillingWorkflow(input: { title: string }) {
  "use workflow";
  const runtime = createRuntime();
  return await executeRuntimeAction({
    runtime,
    action: createInvoiceAction,
    input,
  });
}
```
