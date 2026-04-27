import type { InstantAdminDatabase } from "@instantdb/admin"
import type { InstaQLParams } from "@instantdb/core"
import type { DomainInstantSchema } from "@ekairos/domain"

import { sandboxDomain } from "../actions"

type SandboxSchema = DomainInstantSchema<typeof sandboxDomain>

declare const db: InstantAdminDatabase<SandboxSchema, true>

// given: the sandbox domain links sandboxes to users and processes to sandboxes.
// when: service queries include those relation labels.
const linkedSandboxQuery = {
  sandbox_sandboxes: {
    $: { where: { id: "sandbox_123" }, limit: 1 },
    user: {},
  },
} satisfies InstaQLParams<SandboxSchema>

const linkedProcessQuery = {
  sandbox_processes: {
    $: { where: { id: "process_123" }, limit: 1 },
    sandbox: {},
    stream: {},
  },
} satisfies InstaQLParams<SandboxSchema>

// then: InstantDB accepts the query shape exactly as it accepts a native schema.
void db.query(linkedSandboxQuery)
void db.query(linkedProcessQuery)
