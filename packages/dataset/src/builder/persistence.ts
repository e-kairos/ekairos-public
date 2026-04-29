import { DatasetService } from "../service.js"
import { datasetDomain } from "../schema.js"
import {
  datasetGetByIdStep,
  datasetPreviewRowsStep,
  datasetReadOneStep,
  datasetReadRowsStep,
} from "../dataset/steps.js"
import { inferDatasetSchema, validateRows } from "./schemaInference.js"
import { rowsToJsonl } from "./sourceRows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuildResult,
  DatasetReader,
  DatasetTextSourceInput,
  MaterializeRowsParams,
} from "./types.js"

export function defaultTextSourceName(source: DatasetTextSourceInput): string {
  if (source.name?.trim()) return source.name.trim()
  const mimeType = String(source.mimeType ?? "").toLowerCase()
  if (mimeType.includes("csv")) return "source.csv"
  if (mimeType.includes("json")) return "source.json"
  if (mimeType.includes("yaml") || mimeType.includes("yml")) return "source.yaml"
  return "source.txt"
}

export async function getDatasetDb<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
) {
  const scoped = await (runtime as any).use(datasetDomain)
  return scoped.db as any
}

export async function createOrUpdateDatasetMetadata<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  params: {
    datasetId: string
    sandboxId?: string
    title?: string
    instructions?: string
    sources: any[]
    sourceKinds: string[]
    analysis?: any
    schema?: any
    status?: string
  },
) {
  "use step"
  const db = await getDatasetDb(runtime)
  const service = new DatasetService(db)
  const result = await service.createDataset({
    id: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? params.datasetId,
    instructions: params.instructions ?? "",
    sources: params.sources,
    sourceKinds: params.sourceKinds,
    analysis: params.analysis,
    schema: params.schema,
    status: params.status ?? "building",
    organizationId: runtime.env.orgId,
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
}

export async function materializeRowsToDataset<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  params: MaterializeRowsParams,
): Promise<string> {
  "use step"

  if (params.first && params.rows.length > 1) {
    throw new Error("dataset_first_expected_zero_or_one_row")
  }

  const resolvedSchema =
    params.schema ??
    inferDatasetSchema(
      params.rows,
      params.title ? `${params.title}Row` : "DatasetRow",
      params.title ? `One row for ${params.title}` : "One dataset row",
    )

  validateRows(params.rows, resolvedSchema)

  await createOrUpdateDatasetMetadata(runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title,
    instructions: params.instructions,
    sources: params.sources,
    sourceKinds: params.sourceKinds,
    analysis: params.analysis,
    schema: resolvedSchema,
    status: "building",
  })

  const db = await getDatasetDb(runtime)
  const service = new DatasetService(db)
  const uploadResult = await service.uploadDatasetOutputFile({
    datasetId: params.datasetId,
    fileBuffer: Buffer.from(rowsToJsonl(params.rows), "utf-8"),
  })
  if (!uploadResult.ok) {
    throw new Error(uploadResult.error)
  }

  const statusResult = await service.updateDatasetStatus({
    datasetId: params.datasetId,
    status: "completed",
    calculatedTotalRows: params.rows.length,
    actualGeneratedRowCount: params.rows.length,
  })
  if (!statusResult.ok) {
    throw new Error(statusResult.error)
  }

  return params.datasetId
}

export async function uploadInlineTextSource<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  source: DatasetTextSourceInput,
) {
  "use step"

  const db = await getDatasetDb(runtime)
  const fileName = defaultTextSourceName(source)
  const storagePath = `/dataset/source/${datasetId}/${Date.now()}-${fileName}`
  const uploadResult = await db.storage.uploadFile(storagePath, Buffer.from(source.text, "utf-8"), {
    contentType: source.mimeType ?? "text/plain",
    contentDisposition: fileName,
  })
  const fileId = uploadResult?.data?.id
  if (!fileId) {
    throw new Error("dataset_text_source_upload_failed")
  }
  return fileId as string
}

export async function finalizeBuildResult<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  withFirst: boolean,
): Promise<DatasetBuildResult> {
  const datasetResult = await datasetGetByIdStep({ runtime, datasetId })
  if (!datasetResult.ok) throw new Error(datasetResult.error)
  const previewResult = await datasetPreviewRowsStep({ runtime, datasetId, limit: 20 })

  const reader: DatasetReader = {
    async read(cursorOrParams?: number | { cursor?: number; limit?: number }, limit?: number) {
      const params =
        typeof cursorOrParams === "object" && cursorOrParams !== null
          ? cursorOrParams
          : { cursor: cursorOrParams as number | undefined, limit }
      return await datasetReadRowsStep({
        runtime,
        datasetId,
        cursor: params.cursor,
        limit: params.limit,
      })
    },
  }

  if (!withFirst) {
    return {
      datasetId,
      dataset: datasetResult.data,
      previewRows: previewResult.rows,
      reader,
    }
  }

  const firstResult = await datasetReadOneStep({ runtime, datasetId })

  return {
    datasetId,
    dataset: datasetResult.data,
    previewRows: previewResult.rows,
    reader,
    firstRow: firstResult.row,
  }
}
