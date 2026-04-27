/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { defineDomainAction, domain } from "../index.ts";
import {
  DomainRuntime,
  type RuntimeActionEnv,
  type RuntimeActionShape,
} from "./runtime-actions.test-fixtures.ts";

describe("runtime action recursion guard", () => {
  it("detects action recursion cycles", async () => {
    // given: two actions that call each other through the scoped domain action
    // API. This is the minimum cycle that can happen without any external
    // runtime dispatch.
    const baseCycleDomain = domain("cycle").schema({
      entities: {
        cycle_items: i.entity({
          value: i.number(),
        }),
      },
      links: {},
      rooms: {},
    });

    let cycleDomain: any;
    cycleDomain = baseCycleDomain.withActions({
      actionA: defineDomainAction<RuntimeActionEnv, { value: number }, number, RuntimeActionShape, any>({
        name: "cycle.a",
        async execute({ runtime, input }) {
          "use step";
          const scoped = await runtime.use(cycleDomain);
          return scoped.actions.actionB(input);
        },
      }),
      actionB: defineDomainAction<RuntimeActionEnv, { value: number }, number, RuntimeActionShape, any>({
        name: "cycle.b",
        async execute({ runtime, input }) {
          "use step";
          const scoped = await runtime.use(cycleDomain);
          return scoped.actions.actionA(input);
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      cycleDomain,
      1,
    );
    const scoped = await runtime.use(cycleDomain);

    // when: actionA enters actionB and actionB attempts to re-enter actionA.
    const execution = scoped.actions.actionA({ value: 1 });

    // then: the runtime rejects the recursive action key instead of overflowing
    // or silently starting an unbounded action chain.
    await expect(execution).rejects.toThrow("domain_action_cycle:actionA");
  });
});
