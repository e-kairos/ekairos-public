import { i } from "@instantdb/core";

import {
  EkairosRuntime,
  type RuntimeForDomain,
  domain,
} from "../index";

type Env = {
  orgId: string;
  actorId: string;
};

const taskDomain = domain("tasks").schema({
  entities: {
    tasks: i.entity({
      title: i.string(),
      status: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const billingDomain = domain("billing").schema({
  entities: {
    invoices: i.entity({
      total: i.number(),
      status: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const appDomain = domain("app")
  .includes(taskDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, { runtimeCall: number }> {
  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: 1 };
  }

  appRuntimeOnly() {
    return "app-runtime" as const;
  }
}

class BillingRuntime extends EkairosRuntime<Env, typeof billingDomain, { runtimeCall: number }> {
  protected getDomain() {
    return billingDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: 2 };
  }
}

function taskMethod<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: RuntimeForDomain<Runtime, typeof taskDomain>,
) {
  return runtime;
}

const appRuntime = new AppRuntime({ orgId: "org_1", actorId: "user_1" });

// given: AppRuntime is rooted at appDomain, which includes taskDomain.
// when: a method requires RuntimeForDomain<typeof taskDomain> and appRuntime is
// passed to it.
// then: the runtime remains assignable and keeps AppRuntime-specific methods.
const compatibleRuntime = taskMethod(appRuntime);
compatibleRuntime.appRuntimeOnly();
appRuntime.use(taskDomain);

const billingRuntime = new BillingRuntime({ orgId: "org_1", actorId: "user_1" });

// given: BillingRuntime is rooted at billingDomain, which does not include
// taskDomain.
// when: code asks BillingRuntime to satisfy a task-domain runtime requirement.
// then: both RuntimeForDomain and runtime.use reject it at compile time.
// @ts-expect-error billing runtime does not include taskDomain
taskMethod(billingRuntime);
// @ts-expect-error billing runtime does not include taskDomain
billingRuntime.use(taskDomain);
