import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { threadDomain } from "@ekairos/thread/schema"
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
   * - `thread_contexts.structure_output_file` points to the `$files` record for `output.jsonl`.
   * - Reverse label is prefixed to avoid collisions across domains.
   */
  structureContextOutputFile: {
    forward: { on: "thread_contexts", has: "one", label: "structure_output_file" },
    reverse: { on: "$files", has: "many", label: "structure_contexts" },
  },
} as const

const rooms = {} as const

export const structureDomain: any = domain("structure")
  .includes(threadDomain)
  .includes(sandboxDomain)
  .schema({ entities, links, rooms })


