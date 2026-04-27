import { domain, type DomainInstantSchema } from "..";
import { i, type ValidQuery } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: catalog_products exposes the relation label `prices`, not `pricez`.
const catalogDomain = domain("query-negative-link-catalog").schema({
  entities: {
    catalog_products: i.entity({
      sku: i.string(),
    }),
    catalog_prices: i.entity({
      amount: i.number(),
    }),
  },
  links: {
    catalogProductPrices: {
      forward: { on: "catalog_products", has: "many", label: "prices" },
      reverse: { on: "catalog_prices", has: "one", label: "product" },
    },
  },
  rooms: {},
});

type CatalogSchema = DomainInstantSchema<typeof catalogDomain>;

// when: a query uses a typo in the direct relation label.
type InvalidLinkQuery = {
  catalog_products: {
    pricez: {};
  };
};
type InvalidLinkRejected = InvalidLinkQuery extends ValidQuery<InvalidLinkQuery, CatalogSchema>
  ? false
  : true;

// then: ValidQuery and db.query both reject the invalid relation label.
const _invalidLinkRejected: InvalidLinkRejected = true;

declare const db: InstantAdminDatabase<CatalogSchema, true>;

void db.query({
  catalog_products: {
    // @ts-expect-error typo in relation label must stay rejected
    pricez: {},
  },
});
