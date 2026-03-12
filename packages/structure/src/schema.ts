import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { threadDomain } from "@ekairos/events/schema"
import { sandboxDomain } from "@ekairos/sandbox/schema"

const entities = {
  // Keep $files compatible with Instant's base file fields used by structure flows.
  $files: i.entity({
    path: i.string().optional().indexed(),
    url: i.string().optional(),
    name: i.string().optional(),
    contentType: i.string().optional(),
    size: i.number().optional(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional().indexed(),
    "content-disposition": i.string().optional(),
  }),
} as const

const links = {
  /**
   * Structure output link (rows):
   *
   * - `event_contexts.structure_output_file` points to the `$files` record for `output.jsonl`.
   * - A legacy `thread_contexts` link is kept for mixed deployments during migration.
   * - Reverse label is prefixed to avoid collisions across domains.
   */
  structureContextOutputFile: {
    forward: { on: "event_contexts", has: "one", label: "structure_output_file" },
    reverse: { on: "$files", has: "many", label: "structure_contexts" },
  },
  structureLegacyContextOutputFile: {
    forward: { on: "thread_contexts", has: "one", label: "structure_output_file" },
    reverse: { on: "$files", has: "many", label: "structure_legacy_contexts" },
  },
} as const

const rooms = {} as const

export const structureDomain: any = domain("structure")
  .includes(threadDomain)
  .includes(sandboxDomain)
  .schema({ entities, links, rooms })


