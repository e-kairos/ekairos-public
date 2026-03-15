const STRUCTURE_CONTEXT_ENTITIES = ["event_contexts"] as const

type StructureContextEntity = (typeof STRUCTURE_CONTEXT_ENTITIES)[number]

type FindStructureContextParams = {
  includeOutputFile?: boolean
}

type FindStructureContextResult = {
  entity: StructureContextEntity
  row: any
}

function buildContextQuery(entity: StructureContextEntity, key: string, includeOutputFile: boolean) {
  return {
    [entity]: {
      $: { where: { key } as any, limit: 1 },
      ...(includeOutputFile ? { structure_output_file: {} } : {}),
    } as any,
  } as any
}

function preferredContextEntity(db: any): StructureContextEntity {
  if (db?.tx?.event_contexts) return "event_contexts"
  throw new Error("No persisted context collection is available")
}

export async function findStructureContextByKey(
  db: any,
  key: string,
  params: FindStructureContextParams = {},
): Promise<FindStructureContextResult | null> {
  let lastError: unknown = null
  let queried = false

  for (const entity of STRUCTURE_CONTEXT_ENTITIES) {
    try {
      const res = await db.query(buildContextQuery(entity, key, Boolean(params.includeOutputFile)))
      queried = true
      const row = res?.[entity]?.[0]
      if (row) return { entity, row }
    } catch (error) {
      lastError = error
    }
  }

  if (!queried && lastError) {
    throw lastError
  }

  return null
}

export async function createStructureContext(db: any, params: {
  id: string
  key: string
  content?: Record<string, unknown>
  status?: string
  createdAt?: Date
}) {
  const entity = preferredContextEntity(db)
  await db.transact([
    db.tx[entity][params.id].create({
      createdAt: params.createdAt ?? new Date(),
      content: params.content ?? {},
      key: params.key,
      status: params.status ?? "open",
    } as any),
  ])
  return { entity, id: params.id }
}

export async function linkStructureOutputFileToContextByKey(db: any, params: {
  contextKey: string
  fileId: string
}) {
  const context = await findStructureContextByKey(db, params.contextKey)
  const ctxId = context?.row?.id
  if (!context || !ctxId) {
    throw new Error("Context not found")
  }

  await db.transact([db.tx[context.entity][ctxId].link({ structure_output_file: params.fileId })])
}

export async function unlinkStructureOutputFileFromContextByKey(db: any, params: {
  contextKey: string
  fileId: string
}) {
  const context = await findStructureContextByKey(db, params.contextKey)
  const ctxId = context?.row?.id
  if (!context || !ctxId) {
    throw new Error("Context not found")
  }

  await db.transact([db.tx[context.entity][ctxId].unlink({ structure_output_file: params.fileId })])
}
