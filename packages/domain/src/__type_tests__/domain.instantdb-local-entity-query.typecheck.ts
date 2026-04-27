import { domain, type DomainInstantSchema } from "..";
import { i } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: a domain with a local tender entity and an included requisition entity.
const requisitionDomain = domain("query-local-requisition").schema({
  entities: {
    requisition_requisitions: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const tenderDomain = domain("query-local-tender")
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
declare const db: InstantAdminDatabase<TenderSchema, true>;

// when: a query targets the local entity declared by the including domain.
// then: db.query accepts it with the same schema type used for included
// entities.
void db.query({
  tender_tenders: {},
});
