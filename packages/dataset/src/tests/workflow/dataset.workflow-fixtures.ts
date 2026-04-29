import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { getStepMetadata, getWorkflowMetadata } from "workflow"

import { dataset } from "../../index.ts"
import { datasetDomain } from "../../schema.ts"

const sourceDomain = domain("dataset-workflow-source").schema({
  entities: {
    source_items: i.entity({
      sku: i.string(),
      qty: i.number(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-workflow-test-app")
  .includes(datasetDomain)
  .includes(sourceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type DatasetWorkflowRuntimeEnv = {
  orgId: string
  dbKey: string
  requireStepDb: boolean
  sourceRows: Array<{ id: string; sku: string; qty: number }>
}

type StoredDataset = Record<string, any> & {
  id: string
  datasetId?: string
  dataFileId?: string
}

type StoredFile = {
  id: string
  url: string
  contentDisposition?: string
  contentBase64: string
}

type DatasetWorkflowStore = {
  sourceRows: Array<{ id: string; sku: string; qty: number }>
  datasets: Map<string, StoredDataset>
  files: Map<string, StoredFile>
  nextId: number
}

const storesSymbol = Symbol.for("ekairos.dataset.workflowTestStores")

function stores() {
  const root = globalThis as any
  if (!root[storesSymbol]) {
    root[storesSymbol] = new Map<string, DatasetWorkflowStore>()
  }
  return root[storesSymbol] as Map<string, DatasetWorkflowStore>
}

function getStore(env: DatasetWorkflowRuntimeEnv): DatasetWorkflowStore {
  const existing = stores().get(env.dbKey)
  if (existing) {
    if (existing.sourceRows.length === 0 && env.sourceRows.length > 0) {
      existing.sourceRows = env.sourceRows
    }
    return existing
  }

  const created: DatasetWorkflowStore = {
    sourceRows: env.sourceRows,
    datasets: new Map(),
    files: new Map(),
    nextId: 1,
  }
  stores().set(env.dbKey, created)
  return created
}

async function assertDbCallIsStep(env: DatasetWorkflowRuntimeEnv) {
  if (!env.requireStepDb) return

  let workflowRunId: string | null = null
  try {
    workflowRunId = getWorkflowMetadata?.()?.workflowRunId ?? null
  } catch {
    return
  }

  if (!workflowRunId) return

  try {
    getStepMetadata()
  } catch {
    throw new Error("dataset_db_outside_step")
  }
}

function nextId(store: DatasetWorkflowStore, prefix: string) {
  const value = `${prefix}_${store.nextId}`
  store.nextId++
  return value
}

function entityTx(entity: string, id: string) {
  return {
    update(payload: Record<string, any>) {
      return { entity, id, op: "update", payload }
    },
    link(payload: Record<string, any>) {
      return { entity, id, op: "link", payload }
    },
    delete() {
      return { entity, id, op: "delete" }
    },
  }
}

function txCollection(entity: string) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return entityTx(entity, String(property))
      },
    },
  )
}

function dataUrl(contentBase64: string) {
  return `data:application/x-ndjson;base64,${contentBase64}`
}

function datasetWithLinks(store: DatasetWorkflowStore, dataset: StoredDataset) {
  const file = dataset.dataFileId ? store.files.get(dataset.dataFileId) : null
  return file ? { ...dataset, dataFile: file } : { ...dataset }
}

function createDb(env: DatasetWorkflowRuntimeEnv) {
  const store = getStore(env)
  return {
    tx: {
      dataset_datasets: txCollection("dataset_datasets"),
      dataset_records: txCollection("dataset_records"),
    },
    storage: {
      async uploadFile(path: string, fileBuffer: Buffer, options?: Record<string, any>) {
        await assertDbCallIsStep(env)
        const fileId = nextId(store, "file")
        const contentBase64 = Buffer.from(fileBuffer).toString("base64")
        store.files.set(fileId, {
          id: fileId,
          url: dataUrl(contentBase64),
          contentDisposition: options?.contentDisposition,
          contentBase64,
        })
        return { data: { id: fileId, path } }
      },
    },
    async query(query: Record<string, any>) {
      await assertDbCallIsStep(env)
      if (query.source_items) {
        return { source_items: store.sourceRows.map((row) => ({ ...row })) }
      }

      if (query.dataset_datasets) {
        const where = query.dataset_datasets?.$?.where ?? {}
        const datasetId = where.datasetId
        const rows = Array.from(store.datasets.values())
          .filter((dataset) => !datasetId || dataset.datasetId === datasetId)
          .map((dataset) => datasetWithLinks(store, dataset))
        return { dataset_datasets: rows }
      }

      if (query.$files) {
        const fileId = query.$files?.$?.where?.id
        const rows = fileId && store.files.has(fileId) ? [{ ...store.files.get(fileId) }] : []
        return { $files: rows }
      }

      return {}
    },
    async transact(mutations: any[]) {
      await assertDbCallIsStep(env)
      for (const mutation of mutations.flat()) {
        if (mutation.entity === "dataset_datasets" && mutation.op === "update") {
          const existing = store.datasets.get(mutation.id) ?? { id: mutation.id }
          store.datasets.set(mutation.id, { ...existing, ...mutation.payload, id: mutation.id })
        }
        if (mutation.entity === "dataset_datasets" && mutation.op === "link") {
          const existing = store.datasets.get(mutation.id) ?? { id: mutation.id }
          if (mutation.payload?.dataFile) {
            store.datasets.set(mutation.id, { ...existing, dataFileId: mutation.payload.dataFile })
          }
        }
      }
    },
  }
}

export class DatasetWorkflowTestRuntime extends EkairosRuntime<
  DatasetWorkflowRuntimeEnv,
  typeof appDomain,
  ReturnType<typeof createDb>
> {
  static [WORKFLOW_SERIALIZE](instance: DatasetWorkflowTestRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: DatasetWorkflowRuntimeEnv }) {
    return new DatasetWorkflowTestRuntime(data.env)
  }

  protected getDomain() {
    return appDomain
  }

  protected resolveDb(env: DatasetWorkflowRuntimeEnv) {
    return createDb(env)
  }
}

export type DatasetBuilderWorkflowInput = {
  runtime: DatasetWorkflowTestRuntime
  datasetId: string
}

export type DatasetBuilderWorkflowResult = {
  datasetId: string
  previewRows: any[]
  readRows: any[]
}

export async function datasetQueryBuilderWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetBuilderWorkflowResult> {
  "use workflow";

  const result = await dataset(input.runtime)
    .fromQuery(sourceDomain, {
      query: {
        source_items: {},
      },
      title: "Workflow Source Items",
      explanation: "Workflow-safe query source smoke.",
    })
    .schema({
      title: "WorkflowSourceItem",
      description: "One workflow source item.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sku", "qty"],
        properties: {
          id: { type: "string" },
          sku: { type: "string" },
          qty: { type: "number" },
        },
      },
    })
    .build({ datasetId: input.datasetId })

  const readResult = await result.reader.read({ cursor: 0, limit: 2 })
  return {
    datasetId: result.datasetId,
    previewRows: result.previewRows,
    readRows: readResult.rows,
  }
}
