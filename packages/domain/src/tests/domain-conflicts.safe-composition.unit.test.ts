/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";

import { domain } from "../index.ts";

describe("domain conflict-free composition", () => {
  it("allows non-overlapping included and local entity names", () => {
    // given: included domains and a local schema whose entity names do not
    // overlap.
    const safeDomainA = domain({
      name: "safe-a",
      entities: { profiles: { name: "John" } },
      links: {},
      rooms: {},
    });

    const safeDomainB = domain({
      name: "safe-b",
      entities: { accounts: { balance: 100 } },
      links: {},
      rooms: {},
    });

    // when: the domains are composed with one local transactions entity.
    const result = domain("safe-root")
      .includes(safeDomainA)
      .includes(safeDomainB)
      .schema({
        entities: { transactions: { amount: 50 } },
        links: {},
        rooms: {},
      });

    // then: every entity remains available and no conflict is reported.
    expect(result.entities.profiles).toBeDefined();
    expect(result.entities.accounts).toBeDefined();
    expect(result.entities.transactions).toBeDefined();
  });

  it("merges disjoint attrs when included and local schemas define the same entity", () => {
    // given: a public entity definition and a backend extension that adds
    // private attrs on the same entity.
    const publicDomain = domain("merge-public").schema({
      entities: {
        sandboxes: i.entity({
          sandboxUrl: i.string().optional(),
          status: i.string().indexed(),
        }),
      },
      links: {},
      rooms: {},
    });

    // when: the backend domain repeats the entity name with disjoint attrs.
    const fullDomain = domain("merge-full")
      .includes(publicDomain)
      .schema({
        entities: {
          sandboxes: i.entity({
            externalSandboxId: i.string().optional().indexed(),
            providerConfig: i.json().optional(),
          }),
        },
        links: {},
        rooms: {},
      });

    const attrs = (fullDomain.instantSchema().entities.sandboxes as any).attrs;

    // then: the materialized schema keeps both the public and backend attrs.
    expect(Object.keys(attrs).sort()).toEqual([
      "externalSandboxId",
      "providerConfig",
      "sandboxUrl",
      "status",
    ]);
  });

  it("rejects repeated attrs when merging the same entity name", () => {
    // given: an included domain that already owns the status attr.
    const publicDomain = domain("merge-conflict-public").schema({
      entities: {
        sandboxes: i.entity({
          status: i.string().indexed(),
        }),
      },
      links: {},
      rooms: {},
    });

    // when/then: redefining the same attr in the backend extension fails
    // instead of silently overriding the public definition.
    expect(() =>
      domain("merge-conflict-full")
        .includes(publicDomain)
        .schema({
          entities: {
            sandboxes: i.entity({
              status: i.json().optional(),
            }),
          },
          links: {},
          rooms: {},
        }),
    ).toThrow("domain_duplicate_entity_attr:sandboxes.status");
  });
});
