import { i } from "@instantdb/core"
import { domain } from "../domain"

const entities = {
  dataset_datasets: i.entity({
    status: i.string().optional().indexed(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional(),
    title: i.string().optional(),
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
  $files: i.entity({
    id: i.string().indexed(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional().indexed(),
    name: i.string().optional(),
    type: i.string().optional(),
  }),
} as const

const links = {
  dataset_datasetsOrganization: {
    forward: { on: "dataset_datasets", has: "one", label: "organization" },
    reverse: { on: "organizations", has: "many", label: "dataset_datasets" },
  },
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

export const datasetDomain = domain({ entities, links, rooms })

