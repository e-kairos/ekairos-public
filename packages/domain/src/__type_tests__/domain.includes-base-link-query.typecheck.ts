import type { InstantAdminDatabase } from "@instantdb/admin";
import { i, type InstaQLParams } from "@instantdb/core";

import { domain, type DomainInstantSchema } from "../index.ts";

// given: a public domain links an entity to $users.
const publicProcessDomain = domain("includes-base-link-public").schema({
  entities: {
    sandboxes: i.entity({
      status: i.string().indexed(),
    }),
  },
  links: {
    sandboxUser: {
      forward: { on: "sandboxes", has: "one", label: "user" },
      reverse: { on: "$users", has: "many", label: "sandboxes" },
    },
  },
  rooms: {},
});

// given: a runtime domain includes the public domain and links a local process
// entity to both the public entity and $streams.
const runtimeProcessDomain = domain("includes-base-link-runtime")
  .includes(publicProcessDomain)
  .schema({
    entities: {
      processes: i.entity({
        status: i.string().indexed(),
      }),
    },
    links: {
      processSandbox: {
        forward: { on: "processes", has: "one", label: "sandbox" },
        reverse: { on: "sandboxes", has: "many", label: "processes" },
      },
      processStream: {
        forward: { on: "processes", has: "one", label: "stream" },
        reverse: { on: "$streams", has: "many", label: "processes" },
      },
    },
    rooms: {},
  });

type RuntimeProcessSchema = DomainInstantSchema<typeof runtimeProcessDomain>;

// when: queries follow both included-domain and runtime-domain relation labels.
const sandboxQuery = {
  sandboxes: {
    user: {},
  },
} satisfies InstaQLParams<RuntimeProcessSchema>;

const processQuery = {
  processes: {
    sandbox: {},
    stream: {},
  },
} satisfies InstaQLParams<RuntimeProcessSchema>;

declare const db: InstantAdminDatabase<RuntimeProcessSchema, true>;

// then: included base links and runtime base links remain typed together.
void db.query(sandboxQuery);
void db.query(processQuery);
