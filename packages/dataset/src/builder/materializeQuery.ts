import { materializeRowsToDataset } from "./persistence.js"
import { getDomainDescriptor, normalizeQueryRows } from "./sourceRows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalSource,
} from "./types.js"

async function readQuerySourceRowsStep(params: {
  runtime: any
  query: Record<string, any>
}): Promise<{ rows: any[] }> {
  "use step"
  const db = await params.runtime.db()
  const result = await (db as any).query(params.query as any)
  return { rows: normalizeQueryRows(result) }
}

export async function materializeQuerySource<Runtime extends AnyDatasetRuntime>(
  runtime: DatasetBuilderState<Runtime>["runtime"],
  source: Extract<InternalSource, { kind: "query" }>,
  params: {
    datasetId: string
    sandboxId?: string
    schema?: DatasetSchemaInput
    title?: string
    instructions?: string
    first?: boolean
  },
) {
  const { rows } = await readQuerySourceRowsStep({
    runtime,
    query: source.query as any,
  })
  const domainDescriptor = getDomainDescriptor(source.domain)

  return await materializeRowsToDataset(runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? source.title,
    instructions: params.instructions,
    sources: [
      {
        kind: "query",
        query: source.query,
        title: source.title,
        explanation: source.explanation,
        ...domainDescriptor,
      },
    ],
    sourceKinds: ["query"],
    analysis: {
      query: source.query,
      explanation: source.explanation,
      ...domainDescriptor,
    },
    rows,
    schema: params.schema,
    inferSchema: !params.schema,
    first: params.first,
  })
}
