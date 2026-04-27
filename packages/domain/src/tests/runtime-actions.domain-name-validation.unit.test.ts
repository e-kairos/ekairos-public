/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { domain } from "../index.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

describe("runtime action domain name validation", () => {
  it("validates domain names transitively when scoping a runtime", async () => {
    // given: a runtime rooted at a domain that includes leaf through branch,
    // plus a second domain with the same schema as leaf but a different name.
    const leafDomain = domain("runtime-name-leaf").schema({
      entities: {
        runtime_name_leaf_items: i.entity({
          title: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const branchDomain = domain("runtime-name-branch")
      .includes(leafDomain)
      .schema({
        entities: {
          runtime_name_branch_items: i.entity({
            title: i.string(),
          }),
        },
        links: {},
        rooms: {},
      });

    const rootDomain = domain("runtime-name-root")
      .includes(branchDomain)
      .schema({ entities: {}, links: {}, rooms: {} });

    const sameSchemaOtherName = domain("runtime-name-other").schema({
      entities: {
        runtime_name_leaf_items: i.entity({
          title: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      rootDomain,
      13,
    );

    // when: the runtime is scoped to the included leaf and then to a same-shape
    // domain that was not included by name.
    const scopedLeaf = await runtime.use(leafDomain);
    const invalidScope = runtime.use(sameSchemaOtherName as any);

    // then: the included leaf succeeds, while same schema alone is rejected
    // because runtime compatibility is name plus schema.
    expect(scopedLeaf.db.runtimeCall).toBe(13);
    await expect(invalidScope).rejects.toThrow(
      "missing required names (runtime-name-other)",
    );
  });
});
