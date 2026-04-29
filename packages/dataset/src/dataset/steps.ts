import { DatasetService } from "../service.js"
import { datasetDomain } from "../schema.js"
import { inferDatasetSchema } from "../builder/schemaInference.js"

async function getRuntimeDb(runtime: any) {
  if (!runtime) {
    throw new Error("Dataset step requires runtime.")
  }

  if (typeof runtime.use === "function") {
    const scoped = await runtime.use(datasetDomain)
    const scopedDb = (scoped as any).db
    return typeof scopedDb === "function" ? await scopedDb.call(scoped) : scopedDb
  }

  const db = runtime.db
  return typeof db === "function" ? await db.call(runtime) : db
}

export async function getDatasetServiceDb(runtime: any) {
  "use step"
  return await getRuntimeDb(runtime)
}

export async function datasetGetByIdStep(params: { runtime: any; datasetId: string }) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  return await service.getDatasetById(params.datasetId)
}

export async function datasetReadOutputJsonlStep(params: {
  runtime: any
  datasetId: string
}): Promise<{ contentBase64: string }> {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  for (let attempt = 1; attempt <= 20; attempt++) {
    const query: any = await db.query({
      dataset_datasets: {
        $: { where: { datasetId: params.datasetId } as any, limit: 1 },
        dataFile: {},
      } as any,
    })

    const dataset = query.dataset_datasets?.[0]
    const linkedFile = Array.isArray(dataset?.dataFile) ? dataset.dataFile[0] : dataset?.dataFile
    const url = linkedFile?.url
    if (url) {
      const fileBuffer = await fetch(url).then((r) => r.arrayBuffer())
      return { contentBase64: Buffer.from(fileBuffer).toString("base64") }
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }

  throw new Error("Dataset output file not found")
}

export async function datasetUpdateSchemaStep(params: {
  runtime: any
  datasetId: string
  schema: any
  status?: string
}) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  return await service.updateDatasetSchema({
    datasetId: params.datasetId,
    schema: params.schema,
    status: params.status,
  })
}

export async function datasetUploadOutputFileStep(params: {
  runtime: any
  datasetId: string
  fileBuffer: Buffer
}) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  return await service.uploadDatasetOutputFile({
    datasetId: params.datasetId,
    fileBuffer: params.fileBuffer,
  })
}

export async function datasetUpdateStatusStep(params: {
  runtime: any
  datasetId: string
  status: string
  calculatedTotalRows?: number
  actualGeneratedRowCount?: number
}) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  return await service.updateDatasetStatus({
    datasetId: params.datasetId,
    status: params.status,
    calculatedTotalRows: params.calculatedTotalRows,
    actualGeneratedRowCount: params.actualGeneratedRowCount,
  } as any)
}

export async function datasetClearStep(params: { runtime: any; datasetId: string }) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  return await service.clearDataset(params.datasetId)
}

export async function datasetPreviewRowsStep(params: {
  runtime: any
  datasetId: string
  limit?: number
}): Promise<{ rows: any[] }> {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  const rowsResult = await service.previewRows(params.datasetId, params.limit ?? 20)
  if (!rowsResult.ok) {
    throw new Error(rowsResult.error)
  }
  return { rows: rowsResult.data }
}

export async function datasetReadRowsStep(params: {
  runtime: any
  datasetId: string
  cursor?: number
  limit?: number
}): Promise<{ rows: any[]; cursor: number; done: boolean }> {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  const rowsResult = await service.readRows({
    datasetId: params.datasetId,
    cursor: params.cursor,
    limit: params.limit,
  })
  if (!rowsResult.ok) {
    throw new Error(rowsResult.error)
  }
  return rowsResult.data
}

export async function datasetReadOneStep(params: {
  runtime: any
  datasetId: string
}): Promise<{ row: any | null }> {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  const firstResult = await service.readOne(params.datasetId)
  if (!firstResult.ok) {
    throw new Error(firstResult.error)
  }
  return { row: firstResult.data }
}

export async function datasetInferAndUpdateSchemaStep(params: {
  runtime: any
  datasetId: string
  title?: string
  description?: string
}) {
  "use step"
  const db = await getRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  const readResult = await service.readRows({
    datasetId: params.datasetId,
    cursor: 0,
    limit: 1000,
  })
  if (!readResult.ok) {
    throw new Error(readResult.error)
  }
  const inferred = inferDatasetSchema(
    readResult.data.rows,
    params.title ?? `${params.datasetId}Row`,
    params.description ?? "One dataset row",
  )
  const updateResult = await service.updateDatasetSchema({
    datasetId: params.datasetId,
    schema: inferred,
    status: "completed",
  })
  if (!updateResult.ok) {
    throw new Error(updateResult.error)
  }
  return { schema: inferred }
}

