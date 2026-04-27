/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { defineDomainAction, domain } from "../index.ts";
import {
  DomainRuntime,
  type RuntimeActionEnv,
} from "./runtime-actions.test-fixtures.ts";

describe("runtime action explicit runtime instance", () => {
  it("lets internal clients use an explicit runtime instance directly", async () => {
    // given: a concrete Runtime subclass whose db payload contains a known
    // runtimeCall marker.
    const baseExplicitDomain = domain("explicit").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let explicitDomain: any;
    explicitDomain = baseExplicitDomain.withActions({
      normalizeTitle: defineDomainAction<
        RuntimeActionEnv,
        { title: string },
        { title: string; runtimeCall: number },
        DomainRuntime<any>,
        any
      >({
        name: "explicit.task.normalizeTitle",
        async execute({ input, runtime }) {
          "use step";
          const scoped = await runtime.use(explicitDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: scoped.db.runtimeCall,
          };
        },
      }),
      createTask: defineDomainAction<
        RuntimeActionEnv,
        { title: string },
        { title: string; orgId: string; parentRuntimeCall: number; nestedRuntimeCall: number },
        DomainRuntime<any>,
        any
      >({
        name: "explicit.task.create",
        async execute({ runtime, input }) {
          "use step";
          const scoped = await runtime.use(explicitDomain);
          const normalized = await scoped.actions.normalizeTitle({ title: input.title });
          return {
            title: normalized.title,
            orgId: runtime.env.orgId,
            parentRuntimeCall: scoped.db.runtimeCall,
            nestedRuntimeCall: normalized.runtimeCall,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      explicitDomain,
      7,
    );
    const explicit = await runtime.use(explicitDomain);

    // when: an internal caller invokes the scoped action directly without the
    // global runtime action registry.
    const result = await explicit.actions.createTask({ title: "  Runtime first  " });

    // then: parent and nested actions share the same explicit runtime instance.
    expect(result).toEqual({
      title: "Runtime first",
      orgId: "org_123",
      parentRuntimeCall: 7,
      nestedRuntimeCall: 7,
    });
  });
});
