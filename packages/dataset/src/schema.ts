import { i } from "@instantdb/core"
import { domain, type DomainSchemaResult } from "@ekairos/domain"

const entities = {
  dataset_datasets: i.entity({
    status: i.string().optional().indexed(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional(),
    organizationId: i.string().optional().indexed(),
    title: i.string().optional(),
    sources: i.string().optional(),
    instructions: i.string().optional(),
    analysis: i.json().optional(),
    schema: i.json().optional(),
    calculatedTotalRows: i.number().optional(),
    actualGeneratedRowCount: i.number().optional(),
  }),
  dataset_records: i.entity({
    rowContent: i.json(),
    order: i.number().indexed(),
    createdAt: i.number(),
  }),
  // Keep $files compatible with Instant's base file fields used by dataset agents/tools.
  // (path/url are required by file download + dataset output linking)
  $files: i.entity({
    path: i.string().optional().indexed(),
    url: i.string().optional(),
    name: i.string().optional(),
    contentType: i.string().optional(),
    size: i.number().optional(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional().indexed(),
  }),
} as const

const links = {
  dataset_datasetsRecords: {
    forward: { on: "dataset_datasets", has: "many", label: "records" },
    reverse: { on: "dataset_records", has: "one", label: "dataset" },
  },
  dataset_datasetsFiles: {
    forward: { on: "dataset_datasets", has: "one", label: "dataFile" },
    reverse: { on: "$files", has: "many", label: "datasets" },
  },
} as const

const rooms = {} as const

export const datasetDomain: DomainSchemaResult<typeof entities, typeof links, typeof rooms> = domain("dataset").schema({
  entities,
  links,
  rooms,
})

