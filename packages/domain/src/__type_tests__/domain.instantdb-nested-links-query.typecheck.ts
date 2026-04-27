import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: an included requisition domain with requisitions -> itemGroups ->
// items links.
const requisitionDomain = domain("query-nested-links-requisition").schema({
  entities: {
    requisition_requisitions: i.entity({
      title: i.string(),
    }),
    requisition_itemGroups: i.entity({
      name: i.string().optional(),
    }),
    requisition_items: i.entity({
      quantity: i.number().optional(),
    }),
  },
  links: {
    requisitionItemGroups: {
      forward: { on: "requisition_itemGroups", has: "one", label: "requisition" },
      reverse: { on: "requisition_requisitions", has: "many", label: "itemGroups" },
    },
    requisitionItems: {
      forward: { on: "requisition_itemGroups", has: "many", label: "items" },
      reverse: { on: "requisition_items", has: "one", label: "itemGroup" },
    },
  },
  rooms: {},
});

const tenderDomain = domain("query-nested-links-tender")
  .includes(requisitionDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

type TenderSchema = DomainInstantSchema<typeof tenderDomain>;

// when: a query traverses nested relation labels from an included entity.
const nestedIncludedLinksQuery = {
  requisition_requisitions: {
    itemGroups: {
      items: {},
    },
  },
} satisfies InstaQLParams<TenderSchema>;

declare const db: InstantAdminDatabase<TenderSchema, true>;

// then: InstantDB sees all transitive links after domain composition.
void db.query(nestedIncludedLinksQuery);
