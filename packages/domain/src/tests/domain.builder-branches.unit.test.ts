/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { domain } from "../index.ts";

describe("domain builder branch immutability", () => {
  it("does not mutate base builder branches", () => {
    // given: a builder branch with a core include and another include that will
    // only be added to the right branch.
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

    // when: one branch is materialized as-is and another branch adds extraDomain
    // before materialization.
    const left = baseBuilder.schema({ entities: {}, links: {}, rooms: {} });
    const right = baseBuilder.includes(extraDomain).schema({ entities: {}, links: {}, rooms: {} });

    // then: the extra include appears only on the derived branch and does not
    // mutate the already-materialized left branch.
    expect("core_items" in left.entities).toBe(true);
    expect("extra_items" in left.entities).toBe(false);
    expect("extra_items" in right.entities).toBe(true);
  });
});
