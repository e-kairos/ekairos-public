/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { defineDomainAction, domain } from "../index.ts";
import {
  configureRuntime,
  executeRuntimeAction,
  getRuntimeAction,
  getRuntimeActions,
} from "../runtime.ts";

type Env = {
  orgId: string;
  actorId: string;
};

type RuntimeShape = {
  db: {
    runtimeCall: number;
  };
};

function createManagementDomain() {
  const normalizeTitle = defineDomainAction<
    Env,
    { title: string },
    { title: string; status: "draft"; runtimeCall: number },
    RuntimeShape
  >({
    name: "management.task.normalizeTitle",
    execute({ input, runtime }) {
      return {
        title: String(input.title).trim(),
        status: "draft",
        runtimeCall: runtime.db.runtimeCall,
      };
    },
  });

  const createTask = defineDomainAction<
    Env,
    { title: string },
    {
      title: string;
      status: "draft";
      orgId: string;
      parentRuntimeCall: number;
      nestedRuntimeCall: number;
    },
    RuntimeShape
  >({
    name: "management.task.create",
    async execute({ env, input, runtime, call }) {
      const normalized = await call(normalizeTitle, { title: input.title });
      return {
        title: normalized.title,
        status: normalized.status,
        orgId: env.orgId,
        parentRuntimeCall: runtime.db.runtimeCall,
        nestedRuntimeCall: normalized.runtimeCall,
      };
    },
  });

  const appDomain = domain("management").schema({
    entities: {
      management_tasks: i.entity({
        title: i.string(),
        status: i.string().indexed(),
      }),
    },
    links: {},
    rooms: {},
  }).actions([normalizeTitle, createTask]);

  return { appDomain, normalizeTitle, createTask };
}

describe("runtime domain actions", () => {
  it("registers actions and executes nested calls with runtime isolation", async () => {
    const { appDomain, createTask } = createManagementDomain();
    let resolveCalls = 0;

    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db: { runtimeCall: ++resolveCalls } }),
    });

    const registered = getRuntimeActions().map((entry) => entry.name);
    expect(registered).toEqual([
      "management.task.normalizeTitle",
      "management.task.create",
    ]);
    expect(getRuntimeAction("management.task.create")?.name).toBe(createTask.name);

    const result = await executeRuntimeAction({
      action: "management.task.create",
      env: { orgId: "org_123", actorId: "user_1" },
      input: { title: "  Launch domain actions  " },
    });

    expect(result).toEqual({
      title: "Launch domain actions",
      status: "draft",
      orgId: "org_123",
      parentRuntimeCall: 1,
      nestedRuntimeCall: 2,
    });
  });

  it("fails fast when an action name is not registered", async () => {
    const emptyDomain = domain("empty").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    configureRuntime({
      domain: { domain: emptyDomain },
      runtime: async () => ({ db: { runtimeCall: 1 } }),
    });

    await expect(
      executeRuntimeAction({
        action: "management.task.missing",
        env: { orgId: "org_123", actorId: "user_1" },
        input: {},
      }),
    ).rejects.toThrow("runtime_action_not_found:management.task.missing");
  });

  it("rejects duplicate names between domain actions and runtime explicit actions", () => {
    const { appDomain, createTask } = createManagementDomain();

    expect(() =>
      configureRuntime({
        domain: {
          domain: appDomain,
          actions: [
            defineDomainAction({
              name: createTask.name,
              execute: () => ({ ok: true }),
            }),
          ],
        },
        runtime: async () => ({ db: { runtimeCall: 1 } }),
      }),
    ).toThrow(`duplicate_runtime_action:${createTask.name}`);
  });

  it("detects action recursion cycles", async () => {
    let actionA: any;
    let actionB: any;

    actionA = defineDomainAction<Env, { value: number }, number, RuntimeShape>({
      name: "cycle.a",
      async execute({ call, input }) {
        return call(actionB, input);
      },
    });

    actionB = defineDomainAction<Env, { value: number }, number, RuntimeShape>({
      name: "cycle.b",
      async execute({ call, input }) {
        return call(actionA, input);
      },
    });

    const cycleDomain = domain("cycle").schema({
      entities: {
        cycle_items: i.entity({
          value: i.number(),
        }),
      },
      links: {},
      rooms: {},
    }).actions([actionA, actionB]);

    configureRuntime({
      domain: { domain: cycleDomain },
      runtime: async () => ({ db: { runtimeCall: 1 } }),
    });

    await expect(
      executeRuntimeAction({
        action: actionA,
        env: { orgId: "org_123", actorId: "user_1" },
        input: { value: 1 },
      }),
    ).rejects.toThrow("runtime_action_cycle:cycle.a");
  });
});
