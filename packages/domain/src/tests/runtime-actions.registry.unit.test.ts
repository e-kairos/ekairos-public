/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  configureRuntime,
  executeRuntimeAction,
  getRuntimeAction,
  getRuntimeActions,
} from "../runtime.ts";
import { createManagementDomain } from "./runtime-actions.test-fixtures.ts";

describe("runtime action registry", () => {
  it("registers domain actions and executes nested calls with one resolved runtime", async () => {
    // given: a domain with two actions where createTask calls normalizeTitle
    // through runtime.use(domain). This setup validates the registry path and
    // the nested action path together because the nested call is the behavior
    // that previously risked resolving a separate runtime instance.
    const { appDomain } = createManagementDomain();
    let resolveCalls = 0;

    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db: { runtimeCall: ++resolveCalls } }),
    });

    // when: the runtime is configured, the domain actions are registered under
    // their public names and the create action is executed through the global
    // runtime action dispatcher.
    const registered = getRuntimeActions().map((entry) => entry.name);
    const result = await executeRuntimeAction({
      action: "management.task.create",
      env: { orgId: "org_123", actorId: "user_1" },
      input: { title: "  Launch domain actions  " },
    });

    // then: both actions are discoverable and the nested call observes the same
    // resolved runtime payload as the parent action.
    expect(registered).toEqual([
      "management.task.normalizeTitle",
      "management.task.create",
    ]);
    expect(getRuntimeAction("management.task.create")?.name).toBe("management.task.create");
    expect(result).toEqual({
      title: "Launch domain actions",
      status: "draft",
      orgId: "org_123",
      parentRuntimeCall: 1,
      nestedRuntimeCall: 1,
    });
  });
});
