import { id as newId } from "@instantdb/admin"
import { getThreadRuntime, getThreadEnv } from "@ekairos/thread/runtime"
import { DatasetService } from "../service"

export type QueryDomainStepInput = {
  query: Record<string, any>
  explanation: string
  title?: string
  datasetId?: string
}

export type QueryDomainStepResult = {
  datasetId: string
  previewRows: any[]
  rowCount: number
  explanation: string
}

function normalizeRows(result: any): any[] {
  if (!result || typeof result !== "object") return []
  const entries = Object.entries(result)
  if (entries.length === 0) return []

  if (entries.length === 1) {
    const [key, value] = entries[0]
    if (Array.isArray(value)) {
      return value.map((row) => (row && typeof row === "object" ? row : { value: row }))
    }
    return [{ [key]: value }]
  }

  const rows: any[] = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === "object") {
          rows.push({ __entity: key, ...row })
        } else {
          rows.push({ __entity: key, value: row })
        }
      }
      continue
    }
    rows.push({ __entity: key, value })
  }
  return rows
}

function inferSchema(rows: any[]) {
  const first = rows[0] ?? {}
  const schema: Record<string, string> = {}
  for (const [key, value] of Object.entries(first)) {
    if (typeof value === "number") schema[key] = "number"
    else if (typeof value === "boolean") schema[key] = "boolean"
    else if (value === null || value === undefined) schema[key] = "null"
    else schema[key] = "string"
  }
  return { schema }
}

export async function queryDomainStep(
  params: QueryDomainStepInput,
): Promise<QueryDomainStepResult> {
  "use step"

  const env = await getThreadEnv()
  const runtime = await getThreadRuntime(env)
  const db = runtime.db as any
  const service = new DatasetService(db)

  const datasetId = params.datasetId ?? newId()
  const queryResult = await db.query(params.query as any)
  const rows = normalizeRows(queryResult)
  const previewRows = rows.slice(0, 20)
  const schema = inferSchema(rows)

  const createRes = await service.createDataset({
    id: datasetId,
    title: params.title ?? "domain.query",
    status: "building",
    instructions: params.explanation,
    analysis: { explanation: params.explanation, query: params.query },
    schema,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  if (!createRes.ok) {
    throw new Error(createRes.error)
  }

  const batchSize = 200
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const records = batch.map((row, idx) => ({
      rowContent: row,
      order: i + idx,
    }))
    const addRes = await service.addDatasetRecords({
      datasetId,
      records,
    })
    if (!addRes.ok) {
      throw new Error(addRes.error)
    }
  }

  await service.updateDatasetStatus({
    datasetId,
    status: "completed",
    calculatedTotalRows: rows.length,
    actualGeneratedRowCount: rows.length,
  })

  return {
    datasetId,
    previewRows,
    rowCount: rows.length,
    explanation: params.explanation,
  }
}
