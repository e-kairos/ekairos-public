import { domain, type DomainInstantSchema } from "..";
import { i, type ValidQuery } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: a catalog schema with catalog_products but not catalog_productz.
const catalogDomain = domain("query-negative-entity-catalog").schema({
  entities: {
    catalog_products: i.entity({
      sku: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

type CatalogSchema = DomainInstantSchema<typeof catalogDomain>;

// when: a query uses a typo in the top-level entity name.
type InvalidEntityQuery = {
  catalog_productz: {};
};
type InvalidEntityRejected = InvalidEntityQuery extends ValidQuery<InvalidEntityQuery, CatalogSchema>
  ? false
  : true;

// then: ValidQuery rejects the typo and db.query surfaces the same rejection.
const _invalidEntityRejected: InvalidEntityRejected = true;

declare const db: InstantAdminDatabase<CatalogSchema, true>;

void db.query({
  // @ts-expect-error typo in top-level entity must stay rejected
  catalog_productz: {},
});
