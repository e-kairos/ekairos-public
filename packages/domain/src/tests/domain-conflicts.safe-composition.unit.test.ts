/* @vitest-environment node */

import { describe, expect, it } from "vitest";

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
});
