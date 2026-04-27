import { domain, type DomainInstantSchema } from "..";
import { i, type ValidQuery } from "@instantdb/core";

// given: catalog_products can query prices, but catalog_prices does not expose
// madeUpNestedLink.
const catalogDomain = domain("query-negative-nested-link-catalog").schema({
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

// when: a query uses an invalid nested relation below a valid relation.
type InvalidNestedLinkQuery = {
  catalog_products: {
    prices: {
      madeUpNestedLink: {};
    };
  };
};
type InvalidNestedLinkRejected = InvalidNestedLinkQuery extends ValidQuery<InvalidNestedLinkQuery, CatalogSchema>
  ? false
  : true;

// then: ValidQuery rejects the nested typo as well.
const _invalidNestedLinkRejected: InvalidNestedLinkRejected = true;
