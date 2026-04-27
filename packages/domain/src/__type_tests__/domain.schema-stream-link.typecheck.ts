import type { InstantAdminDatabase } from "@instantdb/admin";
import { i, type InstaQLParams } from "@instantdb/core";

import { domain, type DomainInstantSchema } from "../index.ts";

// given: a domain links a local process entity to InstantDB's managed $streams.
const streamLinkedDomain = domain("schema-stream-link").schema({
  entities: {
    processes: i.entity({
      status: i.string().indexed(),
    }),
  },
  links: {
    processStream: {
      forward: { on: "processes", has: "one", label: "stream" },
      reverse: { on: "$streams", has: "many", label: "processes" },
    },
  },
  rooms: {},
});

type StreamLinkedSchema = DomainInstantSchema<typeof streamLinkedDomain>;

// when: a query follows the stream relation.
const streamLinkedQuery = {
  processes: {
    stream: {},
  },
} satisfies InstaQLParams<StreamLinkedSchema>;

declare const db: InstantAdminDatabase<StreamLinkedSchema, true>;

// then: the $streams base link remains a normal typed InstantDB relation.
void db.query(streamLinkedQuery);
