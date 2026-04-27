/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { domain } from "../index.ts";

describe("domain conflict-free instant schema materialization", () => {
  it("materializes an InstantDB schema for valid non-conflicting domains", () => {
    // given: a valid domain composed from an included posts domain and local
    // comments entity.
    const validDomain = domain("valid-conflict-free")
      .includes(
        domain({
          name: "valid-posts",
          entities: { posts: { title: "Test" } },
          links: {},
          rooms: {},
        }),
      )
      .schema({
        entities: { comments: { text: "Comment" } },
        links: {},
        rooms: {},
      });

    // when: the domain is materialized to an InstantDB schema.
    const schema = validDomain.toInstantSchema();

    // then: materialization succeeds and returns a schema object.
    expect(schema).toBeDefined();
  });
});
