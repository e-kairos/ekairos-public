import { getThreadRuntime, getThreadEnv } from "@ekairos/thread/runtime"
import { DatasetService } from "../service"

async function resolveEnv(env?: any) {
  return env ?? (await getThreadEnv())
}

export async function getDatasetServiceDb(env?: any) {
  "use step"
  const runtime = (await getThreadRuntime(await resolveEnv(env))) as any
  return runtime.db as any
}

export async function datasetGetByIdStep(params: { env?: any; datasetId: string }) {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.getDatasetById(params.datasetId)
}

export async function datasetReadOutputJsonlStep(params: {
  env?: any
  datasetId: string
}): Promise<{ contentBase64: string }> {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db

  const query: any = await db.query({
    dataset_datasets: {
      $: { where: { id: params.datasetId } as any, limit: 1 },
      dataFile: {},
    } as any,
  })

  const dataset = query.dataset_datasets?.[0]
  const linkedFile = Array.isArray(dataset?.dataFile) ? dataset.dataFile[0] : dataset?.dataFile
  const url = linkedFile?.url
  if (!url) {
    throw new Error("Dataset output file not found")
  }

  const fileBuffer = await fetch(url).then((r) => r.arrayBuffer())
  return { contentBase64: Buffer.from(fileBuffer).toString("base64") }
}

export async function datasetUpdateSchemaStep(params: {
  env?: any
  datasetId: string
  schema: any
  status?: string
}) {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.updateDatasetSchema({
    datasetId: params.datasetId,
    schema: params.schema,
    status: params.status,
  })
}

export async function datasetUploadOutputFileStep(params: {
  env?: any
  datasetId: string
  fileBuffer: Buffer
}) {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.uploadDatasetOutputFile({
    datasetId: params.datasetId,
    fileBuffer: params.fileBuffer,
  })
}

export async function datasetUpdateStatusStep(params: {
  env?: any
  datasetId: string
  status: string
  calculatedTotalRows?: number
  actualGeneratedRowCount?: number
}) {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.updateDatasetStatus({
    datasetId: params.datasetId,
    status: params.status,
    calculatedTotalRows: params.calculatedTotalRows,
    actualGeneratedRowCount: params.actualGeneratedRowCount,
  } as any)
}

export async function datasetClearStep(params: { env?: any; datasetId: string }) {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.clearDataset(params.datasetId)
}

export async function datasetPreviewRowsStep(params: {
  env?: any
  datasetId: string
  limit?: number
}): Promise<{ rows: any[] }> {
  "use step"
  const db = (await getThreadRuntime(await resolveEnv(params.env)) as any).db
  const limit = params.limit ?? 20
  const query: any = await db.query({
    dataset_records: {
      $: {
        where: { "dataset.id": params.datasetId } as any,
        order: { order: "asc" },
        limit,
      },
      dataset: {},
    } as any,
  })

  const rows = Array.isArray(query.dataset_records)
    ? query.dataset_records.map((r: any) => r?.rowContent).filter((r: any) => r !== undefined)
    : []
  return { rows }
}

