import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: tender includes the requisition domain.
const requisitionDomain = domain("query-included-requisition").schema({
  entities: {
    requisition_requisitions: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const tenderDomain = domain("query-included-tender")
  .includes(requisitionDomain)
  .schema({
    entities: {
      tender_tenders: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  });

type TenderSchema = DomainInstantSchema<typeof tenderDomain>;

// when: a query targets an entity that comes only from the included domain.
const includedEntityQuery = {
  requisition_requisitions: {
    $: { where: { id: "req_1" } },
  },
} satisfies InstaQLParams<TenderSchema>;

declare const db: InstantAdminDatabase<TenderSchema, true>;

// then: db.query accepts the included entity exactly as it accepts local
// entities.
void db.query(includedEntityQuery);
