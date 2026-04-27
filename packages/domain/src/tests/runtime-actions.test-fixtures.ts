import { i } from "@instantdb/core";

import { EkairosRuntime } from "../runtime.ts";
import { domain } from "../index.ts";

export type RuntimeActionEnv = {
  orgId: string;
  actorId: string;
};

export type RuntimeActionShape = {
  db: {
    runtimeCall: number;
  };
};

export class DomainRuntime<RootDomain> extends EkairosRuntime<
  RuntimeActionEnv,
  RootDomain,
  RuntimeActionShape["db"]
> {
  private readonly runtimeCall: number;
  private readonly rootDomain: RootDomain;

  constructor(env: RuntimeActionEnv, rootDomain: RootDomain, runtimeCall = 1) {
    super(env);
    this.rootDomain = rootDomain;
    this.runtimeCall = runtimeCall;
  }

  protected getDomain() {
    return this.rootDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: this.runtimeCall };
  }
}

export function createManagementDomain() {
  const baseDomain = domain("management").schema({
    entities: {
      management_tasks: i.entity({
        title: i.string(),
        status: i.string().indexed(),
      }),
    },
    links: {},
    rooms: {},
  });

  let appDomain: any;
  appDomain = baseDomain.withActions({
    normalizeTitle: {
      name: "management.task.normalizeTitle",
      description: "Normalize task titles.",
      execute: async ({ input, runtime }) => {
        "use step";
        const scoped = await runtime.use(appDomain);
        return {
          title: String(input.title).trim(),
          status: "draft" as const,
          runtimeCall: scoped.db.runtimeCall,
        };
      },
    },
    createTask: {
      name: "management.task.create",
      description: "Create a draft task.",
      execute: async ({ env, input, runtime }) => {
        "use step";
        const scoped = await runtime.use(appDomain);
        const normalized = await scoped.actions.normalizeTitle({ title: input.title });
        return {
          title: normalized.title,
          status: normalized.status,
          orgId: env.orgId,
          parentRuntimeCall: scoped.db.runtimeCall,
          nestedRuntimeCall: normalized.runtimeCall,
        };
      },
    },
  });

  return { appDomain };
}
