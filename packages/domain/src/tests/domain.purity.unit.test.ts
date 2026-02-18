/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { defineDomainAction, domain } from "../index.ts";

function duplicateLinkAttributes(links: Record<string, any>) {
  const ownership = new Map<string, string>();
  const duplicates: string[] = [];

  for (const [linkKey, linkValue] of Object.entries(links ?? {})) {
    const forward = linkValue?.forward;
    if (forward?.on && forward?.label) {
      const key = `${String(forward.on)}->${String(forward.label)}`;
      const first = ownership.get(key);
      if (first && first !== linkKey) duplicates.push(key);
      if (!first) ownership.set(key, linkKey);
    }

    const reverse = linkValue?.reverse;
    if (reverse?.on && reverse?.label) {
      const key = `${String(reverse.on)}->${String(reverse.label)}`;
      const first = ownership.get(key);
      if (first && first !== linkKey) duplicates.push(key);
      if (!first) ownership.set(key, linkKey);
    }
  }

  return duplicates;
}

describe("domain purity and immutability", () => {
  it("keeps toInstantSchema idempotent across repeated calls", () => {
    const organizationDomain = domain("organization").schema({
      entities: {
        organization_organizations: i.entity({
          name: i.string().indexed(),
        }),
      },
      links: {},
      rooms: {},
    });

    const codeDomain = domain("code")
      .includes(organizationDomain)
      .schema({
        entities: {
          code_tasks: i.entity({
            title: i.string(),
          }),
        },
        links: {
          codeTasksOrganization: {
            forward: { on: "code_tasks", has: "one", label: "organization" },
            reverse: {
              on: "organization_organizations",
              has: "many",
              label: "codeTasks",
            },
          },
        },
        rooms: {},
      });

    const appDomain = domain("app")
      .includes(organizationDomain)
      .includes(codeDomain)
      .schema({ entities: {}, links: {}, rooms: {} });

    const first = appDomain.toInstantSchema();
    const second = appDomain.toInstantSchema();

    expect(duplicateLinkAttributes(first.links as any)).toEqual([]);
    expect(duplicateLinkAttributes(second.links as any)).toEqual([]);
    expect(Object.keys(first.links).sort()).toEqual(Object.keys(second.links).sort());
  });

  it("does not mutate base builder branches", () => {
    const coreDomain = domain("core").schema({
      entities: {
        core_items: i.entity({
          name: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const extraDomain = domain("extra").schema({
      entities: {
        extra_items: i.entity({
          name: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const baseBuilder = domain("app").includes(coreDomain);
    const left = baseBuilder.schema({ entities: {}, links: {}, rooms: {} });
    const right = baseBuilder.includes(extraDomain).schema({ entities: {}, links: {}, rooms: {} });

    expect("core_items" in left.entities).toBe(true);
    expect("extra_items" in left.entities).toBe(false);
    expect("extra_items" in right.entities).toBe(true);
  });

  it("returns a new immutable domain result when registering actions", () => {
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

    const withCreate = baseDomain.actions([createTask]);
    const withCreateAndUpdate = withCreate.actions([updateTask]);

    expect(baseDomain).not.toBe(withCreate);
    expect(withCreate).not.toBe(withCreateAndUpdate);
    expect(withCreate.getActions().map((entry) => entry.name)).toEqual([
      "management.task.create",
    ]);
    expect(withCreateAndUpdate.getActions().map((entry) => entry.name)).toEqual([
      "management.task.create",
      "management.task.update",
    ]);
  });
});
