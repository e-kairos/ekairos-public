import { domain, type DomainInstantSchema } from "..";
import { i, type ValidQuery } from "@instantdb/core";

// given: an included requisition domain with a nested item quantity field.
const requisitionDomain = domain("query-nested-where-requisition").schema({
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

const tenderDomain = domain("query-nested-where-tender")
  .includes(requisitionDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

type TenderSchema = DomainInstantSchema<typeof tenderDomain>;

// when: a ValidQuery uses a dotted path through two included-domain relation
// labels.
type QueryWithNestedWhere = {
  requisition_requisitions: {
    $: {
      where?: {
        "itemGroups.items.quantity"?: { $gt: 0 };
      };
    };
    itemGroups: {
      items: {};
    };
  };
};

type QueryWithNestedWhereOk = QueryWithNestedWhere extends ValidQuery<QueryWithNestedWhere, TenderSchema>
  ? true
  : false;

// then: the dotted path remains valid after domain composition.
const _queryWithNestedWhereOk: QueryWithNestedWhereOk = true;
