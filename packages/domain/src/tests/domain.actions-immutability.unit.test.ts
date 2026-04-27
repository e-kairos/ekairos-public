/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { defineDomainAction, domain } from "../index.ts";

describe("domain action registration immutability", () => {
  it("returns a new immutable domain result when registering actions", () => {
    // given: a materialized domain with no actions and two independently
    // defined action descriptors.
    const baseDomain = domain("management").schema({
      entities: {
        management_tasks: i.entity({
          title: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const createTask = defineDomainAction({
      name: "management.task.create",
      execute: async () => ({ ok: true }),
    });
    const updateTask = defineDomainAction({
      name: "management.task.update",
      execute: async () => ({ ok: true }),
    });

    // when: actions are registered in two steps.
    const withCreate = baseDomain.withActions([createTask]);
    const withCreateAndUpdate = withCreate.withActions([updateTask]);

    // then: each registration returns a new domain value and preserves the
    // action list that existed at that point in the chain.
    expect(baseDomain).not.toBe(withCreate);
    expect(withCreate).not.toBe(withCreateAndUpdate);
    expect(withCreate.getActions().map((entry) => entry.name)).toEqual([
      "management.task.create",
    ]);
    expect(withCreateAndUpdate.getActions().map((entry) => entry.name)).toEqual([
      "management.task.create",
      "management.task.update",
    ]);
    expect(Object.values(withCreateAndUpdate.actions).map((entry) => entry.name)).toEqual([
      "management.task.create",
      "management.task.update",
    ]);
  });
});
