/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { domain } from "../index.ts";
import { configureRuntime, executeRuntimeAction } from "../runtime.ts";

describe("runtime action missing action handling", () => {
  it("fails fast when an action name is not registered", async () => {
    // given: a configured runtime whose domain intentionally exposes no
    // actions.
    const emptyDomain = domain("empty").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    configureRuntime({
      domain: { domain: emptyDomain },
      runtime: async () => ({ db: { runtimeCall: 1 } }),
    });

    // when: a caller asks the dispatcher to execute an unknown action name.
    const execution = executeRuntimeAction({
      action: "management.task.missing",
      env: { orgId: "org_123", actorId: "user_1" },
      input: {},
    });

    // then: the dispatcher rejects before resolving user code or runtime state.
    await expect(execution).rejects.toThrow("runtime_action_not_found:management.task.missing");
  });
});
