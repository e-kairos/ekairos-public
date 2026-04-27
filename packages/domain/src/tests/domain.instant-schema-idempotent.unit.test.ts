/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { domain } from "../index.ts";

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

describe("domain instant schema idempotence", () => {
  it("keeps instant schema materialization idempotent across repeated calls", () => {
    // given: a composed domain where the same organization domain is included
    // directly and transitively through another domain. This is the case that
    // can accidentally duplicate generated link attrs if materialization mutates
    // shared state.
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

    // when: the same domain is materialized multiple times through both the
    // legacy alias and the preferred instantSchema method.
    const first = appDomain.toInstantSchema();
    const second = appDomain.toInstantSchema();
    const third = appDomain.instantSchema();

    // then: every materialization has stable link keys and no duplicate link
    // attrs.
    expect(duplicateLinkAttributes(first.links as any)).toEqual([]);
    expect(duplicateLinkAttributes(second.links as any)).toEqual([]);
    expect(duplicateLinkAttributes(third.links as any)).toEqual([]);
    expect(Object.keys(first.links).sort()).toEqual(Object.keys(second.links).sort());
    expect(Object.keys(first.links).sort()).toEqual(Object.keys(third.links).sort());
  });
});
