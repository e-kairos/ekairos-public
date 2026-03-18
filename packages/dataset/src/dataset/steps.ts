import { getContextRuntime, getContextEnv } from "@ekairos/events/runtime"
import { DatasetService } from "../service"

async function resolveEnv(env?: any) {
  return env ?? (await getContextEnv())
}

export async function getDatasetServiceDb(env?: any) {
  "use step"
  const runtime = (await getContextRuntime(await resolveEnv(env))) as any
  return runtime.db as any
}

export async function datasetGetByIdStep(params: { env?: any; datasetId: string }) {
  "use step"
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.getDatasetById(params.datasetId)
}

export async function datasetReadOutputJsonlStep(params: {
  env?: any
  datasetId: string
}): Promise<{ contentBase64: string }> {
  "use step"
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
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
  env?: any
  datasetId: string
  schema: any
  status?: string
}) {
  "use step"
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
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
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
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
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
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
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  return await service.clearDataset(params.datasetId)
}

export async function datasetPreviewRowsStep(params: {
  env?: any
  datasetId: string
  limit?: number
}): Promise<{ rows: any[] }> {
  "use step"
  const db = (await getContextRuntime(await resolveEnv(params.env)) as any).db
  const service = new DatasetService(db)
  const rowsResult = await service.previewRows(params.datasetId, params.limit ?? 20)
  if (!rowsResult.ok) {
    throw new Error(rowsResult.error)
  }
  return { rows: rowsResult.data }
}

