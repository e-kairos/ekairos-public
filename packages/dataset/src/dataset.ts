import { id as newId } from "@instantdb/admin"
import type { DomainSchemaResult } from "@ekairos/domain"
import { resolveRuntime } from "@ekairos/domain/runtime"
import { getContextRuntime } from "@ekairos/events/runtime"
import type { ContextReactor } from "@ekairos/events"
import Ajv from "ajv"
import { createFileParseStory } from "./file/file-dataset.agent"
import { createTransformDatasetStory } from "./transform/transform-dataset.agent"
import { DatasetService } from "./service"

export type DatasetQuerySourceInput<D extends DomainSchemaResult = DomainSchemaResult> = {
  query: Record<string, any>
  title?: string
  explanation?: string
  domain: D
}

export type DatasetFileSourceInput = {
  fileId: string
  description?: string
}

export type DatasetTextSourceInput = {
  text: string
  mimeType?: string
  name?: string
  description?: string
}

export type DatasetExistingSourceInput = {
  datasetId: string
  description?: string
}

export type DatasetSchemaInput = {
  title?: string
  description?: string
  schema: any
}

type InternalSource =
  | ({ kind: "file" } & DatasetFileSourceInput)
  | ({ kind: "text" } & DatasetTextSourceInput)
  | ({ kind: "dataset" } & DatasetExistingSourceInput)
  | ({ kind: "query" } & DatasetQuerySourceInput)

export type DatasetReaderResult = {
  rows: any[]
  cursor: number
  done: boolean
}

export type DatasetReader = {
  read(cursor?: number, limit?: number): Promise<DatasetReaderResult>
  read(params?: { cursor?: number; limit?: number }): Promise<DatasetReaderResult>
}

export type DatasetBuildResult = {
  datasetId: string
  dataset: any
  previewRows: any[]
  reader: DatasetReader
  firstRow?: any | null
}

type DatasetBuilderState<Env extends { orgId: string }> = {
  env: Env
  sources: InternalSource[]
  title?: string
  sandboxId?: string
  outputSchema?: DatasetSchemaInput
  inferSchema: boolean
  instructions?: string
  reactor?: ContextReactor<any, any>
  first: boolean
}

type MaterializeRowsParams = {
  datasetId: string
  sandboxId?: string
  title?: string
  instructions?: string
  sources: any[]
  sourceKinds: string[]
  analysis?: any
  rows: any[]
  schema?: DatasetSchemaInput
  inferSchema?: boolean
  first?: boolean
}

const ajv = new Ajv({ allErrors: true, strict: false })

function defaultTextSourceName(source: DatasetTextSourceInput): string {
  if (source.name?.trim()) return source.name.trim()
  const mimeType = String(source.mimeType ?? "").toLowerCase()
  if (mimeType.includes("csv")) return "source.csv"
  if (mimeType.includes("json")) return "source.json"
  if (mimeType.includes("yaml") || mimeType.includes("yml")) return "source.yaml"
  return "source.txt"
}

function inferJsonSchemaType(value: unknown): any {
  if (value === null) return { type: "null" }
  if (Array.isArray(value)) return { type: "array" }
  switch (typeof value) {
    case "number":
      return { type: "number" }
    case "boolean":
      return { type: "boolean" }
    case "object":
      return { type: "object", additionalProperties: true }
    default:
      return { type: "string" }
  }
}

function inferDatasetSchema(rows: any[], title = "DatasetRow", description = "One dataset row"): DatasetSchemaInput {
  const properties: Record<string, any> = {}
  const required: string[] = []
  const keys = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    for (const key of Object.keys(row)) {
      keys.add(key)
    }
  }

  for (const key of keys) {
    const values = rows.map((row) => (row && typeof row === "object" ? row[key] : undefined))
    const firstDefined = values.find((value) => value !== undefined)
    properties[key] = {
      ...inferJsonSchemaType(firstDefined),
      description: `${key} value`,
    }
    if (values.every((value) => value !== undefined)) {
      required.push(key)
    }
  }

  return {
    title,
    description,
    schema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  }
}

function validateRows(rows: any[], schema: DatasetSchemaInput) {
  const validator = ajv.compile(schema.schema)
  for (const row of rows) {
    const valid = validator(row)
    if (!valid) {
      const error = validator.errors?.map((entry) => entry.message || "validation_error").join("; ")
      throw new Error(error || "dataset_schema_validation_failed")
    }
  }
}

function rowsToJsonl(rows: any[]): string {
  return rows
    .map((row) =>
      JSON.stringify({
        type: "row",
        data: row,
      }),
    )
    .join("\n")
    .concat(rows.length > 0 ? "\n" : "")
}

function normalizeQueryRows(result: any): any[] {
  if (!result || typeof result !== "object") return []
  const entries = Object.entries(result)
  if (entries.length === 0) return []

  if (entries.length === 1) {
    const [key, value] = entries[0]
    if (Array.isArray(value)) {
      return value.map((row) => (row && typeof row === "object" ? row : { value: row }))
    }
    if (value && typeof value === "object") {
      return [value]
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
    if (value && typeof value === "object") {
      rows.push({ __entity: key, ...value })
      continue
    }
    rows.push({ __entity: key, value })
  }
  return rows
}

function getDomainDescriptor(domain: DomainSchemaResult) {
  const meta = (domain as any)?.meta ?? {}
  const context = typeof (domain as any)?.context === "function" ? (domain as any).context() : {}
  const name = String(meta?.name ?? context?.name ?? "domain")
  const packageName = String(meta?.packageName ?? "")
  return {
    domainName: name,
    ...(packageName ? { domainPackageName: packageName } : {}),
  }
}

function makeIntermediateDatasetId(targetDatasetId: string, sourceKind: string, index: number) {
  return `${targetDatasetId}__${sourceKind}_${index}`
}

function buildFileDefaultInstructions(schema?: DatasetSchemaInput) {
  if (schema) {
    return "Create a dataset from the source file and ensure each output row matches the provided dataset schema exactly."
  }
  return "Create a dataset representing the source content as structured rows."
}

function buildRawSourceInstructions(sourceKind: "file" | "text") {
  if (sourceKind === "text") {
    return "Create a dataset representing the raw text content as structured rows without applying business transformations."
  }
  return "Create a dataset representing the raw file content as structured rows without applying business transformations."
}

function buildTransformInstructions(sourceCount: number, userInstructions?: string, schema?: DatasetSchemaInput) {
  const explicit = String(userInstructions ?? "").trim()
  if (explicit) return explicit
  if (sourceCount > 1) {
    if (schema) {
      return "Combine the source datasets into a new dataset that matches the provided output schema exactly."
    }
    return "Combine the source datasets into one coherent dataset."
  }
  if (schema) {
    return "Transform the source dataset into a new dataset that matches the provided output schema exactly."
  }
  return "Transform the source dataset into a new useful dataset."
}

async function getDatasetDb(env: { orgId: string }) {
  const runtime = (await getContextRuntime(env as any)) as any
  return runtime.db as any
}

async function createOrUpdateDatasetMetadata(
  env: { orgId: string },
  params: {
    datasetId: string
    sandboxId?: string
    title?: string
    instructions?: string
    sources: any[]
    sourceKinds: string[]
    analysis?: any
    schema?: DatasetSchemaInput
    status?: string
  },
) {
  const db = await getDatasetDb(env)
  const service = new DatasetService(db)
  const result = await service.createDataset({
    id: params.datasetId,
    title: params.title ?? params.datasetId,
    instructions: params.instructions ?? "",
    sources: params.sources,
    sourceKinds: params.sourceKinds,
    analysis: params.analysis,
    schema: params.schema,
    status: params.status ?? "building",
    organizationId: env.orgId,
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
}

async function materializeRowsToDataset(
  env: { orgId: string },
  params: MaterializeRowsParams,
): Promise<string> {
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

  await createOrUpdateDatasetMetadata(env, {
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

  const db = await getDatasetDb(env)
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

async function uploadInlineTextSource(
  env: { orgId: string },
  datasetId: string,
  source: DatasetTextSourceInput,
) {
  const db = await getDatasetDb(env)
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

async function finalizeBuildResult(
  env: { orgId: string },
  datasetId: string,
  withFirst: boolean,
): Promise<DatasetBuildResult> {
  const db = await getDatasetDb(env)
  const service = new DatasetService(db)
  const datasetResult = await service.getDatasetById(datasetId)
  if (!datasetResult.ok) {
    throw new Error(datasetResult.error)
  }
  const previewResult = await service.previewRows(datasetId, 20)
  if (!previewResult.ok) {
    throw new Error(previewResult.error)
  }

  const reader: DatasetReader = {
    async read(cursorOrParams?: number | { cursor?: number; limit?: number }, limit?: number) {
      const params =
        typeof cursorOrParams === "object" && cursorOrParams !== null
          ? cursorOrParams
          : { cursor: cursorOrParams as number | undefined, limit }
      const rowsResult = await service.readRows({
        datasetId,
        cursor: params.cursor,
        limit: params.limit,
      })
      if (!rowsResult.ok) {
        throw new Error(rowsResult.error)
      }
      return rowsResult.data
    },
  }

  if (!withFirst) {
    return {
      datasetId,
      dataset: datasetResult.data,
      previewRows: previewResult.data,
      reader,
    }
  }

  const firstResult = await service.readOne(datasetId)
  if (!firstResult.ok) {
    throw new Error(firstResult.error)
  }

  return {
    datasetId,
    dataset: datasetResult.data,
    previewRows: previewResult.data,
    reader,
    firstRow: firstResult.data,
  }
}

async function materializeQuerySource(
  env: { orgId: string },
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
  const runtime = await resolveRuntime(source.domain as any, env as any)
  const result = await runtime.db.query(source.query as any)
  const rows = normalizeQueryRows(result)
  const domainDescriptor = getDomainDescriptor(source.domain)

  return await materializeRowsToDataset(env, {
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

async function materializeSingleFileLikeSource(
  state: DatasetBuilderState<{ orgId: string }>,
  source: Extract<InternalSource, { kind: "file" | "text" }>,
  targetDatasetId: string,
) {
  if (!state.reactor) {
    throw new Error("dataset_reactor_required")
  }
  if (!state.sandboxId) {
    throw new Error("dataset_sandbox_required")
  }

  const fileId =
    source.kind === "file"
      ? source.fileId
      : await uploadInlineTextSource(state.env, targetDatasetId, source)

  await createOrUpdateDatasetMetadata(state.env, {
    datasetId: targetDatasetId,
    sandboxId: state.sandboxId,
    title: state.title ?? targetDatasetId,
    instructions: state.instructions,
    sources: [
      source.kind === "file"
        ? { kind: "file", fileId: source.fileId, description: source.description }
        : {
            kind: "text",
            mimeType: source.mimeType,
            name: source.name,
            description: source.description,
          },
    ],
    sourceKinds: [source.kind],
    schema: state.outputSchema,
    status: "building",
  })

  const parseStory = createFileParseStory<typeof state.env>(fileId, {
    datasetId: targetDatasetId,
    instructions: state.instructions ?? buildFileDefaultInstructions(state.outputSchema),
    reactor: state.reactor as any,
    sandboxId: state.sandboxId,
  })

  await parseStory.parse(state.env)

  if (!state.outputSchema) {
    const db = await getDatasetDb(state.env)
    const service = new DatasetService(db)
    const readResult = await service.readRows({ datasetId: targetDatasetId, cursor: 0, limit: 1000 })
    if (!readResult.ok) {
      throw new Error(readResult.error)
    }
    const inferred = inferDatasetSchema(readResult.data.rows, `${targetDatasetId}Row`, "One dataset row")
    const updateResult = await service.updateDatasetSchema({
      datasetId: targetDatasetId,
      schema: inferred,
      status: "completed",
    })
    if (!updateResult.ok) {
      throw new Error(updateResult.error)
    }
  }

  if (state.first) {
    const db = await getDatasetDb(state.env)
    const service = new DatasetService(db)
    const firstResult = await service.readOne(targetDatasetId)
    if (!firstResult.ok) {
      throw new Error(firstResult.error)
    }
  }

  return targetDatasetId
}

async function normalizeSourceToDatasetId(
  state: DatasetBuilderState<{ orgId: string }>,
  source: InternalSource,
  targetDatasetId: string,
  sourceIndex: number,
) {
  if (source.kind === "dataset") {
    return source.datasetId
  }

  const intermediateDatasetId = makeIntermediateDatasetId(targetDatasetId, source.kind, sourceIndex)

  if (source.kind === "query") {
    await materializeQuerySource(state.env, source, {
      datasetId: intermediateDatasetId,
      sandboxId: state.sandboxId,
      title: source.title,
      first: false,
    })
    return intermediateDatasetId
  }

  await materializeSingleFileLikeSource(
    {
      ...state,
      outputSchema: undefined,
      first: false,
      instructions: buildRawSourceInstructions(source.kind),
    },
    source,
    intermediateDatasetId,
  )
  return intermediateDatasetId
}

async function materializeDerivedDataset(
  state: DatasetBuilderState<{ orgId: string }>,
  targetDatasetId: string,
) {
  if (!state.reactor) {
    throw new Error("dataset_reactor_required")
  }
  if (!state.sandboxId) {
    throw new Error("dataset_sandbox_required")
  }

  const normalizedSources: string[] = []
  for (let index = 0; index < state.sources.length; index++) {
    normalizedSources.push(await normalizeSourceToDatasetId(state, state.sources[index], targetDatasetId, index))
  }

  const transformSchema =
    state.outputSchema ??
    ({
      title: "DatasetRow",
      description: "One dataset row",
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {},
      },
    } satisfies DatasetSchemaInput)

  await createOrUpdateDatasetMetadata(state.env, {
    datasetId: targetDatasetId,
    sandboxId: state.sandboxId,
    title: state.title ?? targetDatasetId,
    instructions: state.instructions,
    sources: state.sources.map((source) =>
      source.kind === "query"
        ? {
            kind: "query",
            query: source.query,
            title: source.title,
            explanation: source.explanation,
            ...getDomainDescriptor(source.domain),
          }
        : source,
    ),
    sourceKinds: state.sources.map((source) => source.kind),
    schema: transformSchema,
    status: "building",
  })

  const transformStory = createTransformDatasetStory<typeof state.env>({
    sourceDatasetIds: normalizedSources,
    outputSchema: transformSchema,
    instructions: buildTransformInstructions(normalizedSources.length, state.instructions, state.outputSchema),
    datasetId: targetDatasetId,
    reactor: state.reactor as any,
    sandboxId: state.sandboxId,
  })

  await transformStory.transform(state.env)

  const db = await getDatasetDb(state.env)
  const service = new DatasetService(db)
  if (!state.outputSchema) {
    const readResult = await service.readRows({ datasetId: targetDatasetId, cursor: 0, limit: 1000 })
    if (!readResult.ok) {
      throw new Error(readResult.error)
    }
    const inferred = inferDatasetSchema(readResult.data.rows, `${targetDatasetId}Row`, "One dataset row")
    const updateResult = await service.updateDatasetSchema({
      datasetId: targetDatasetId,
      schema: inferred,
      status: "completed",
    })
    if (!updateResult.ok) {
      throw new Error(updateResult.error)
    }
  }

  if (state.first) {
    const firstResult = await service.readOne(targetDatasetId)
    if (!firstResult.ok) {
      throw new Error(firstResult.error)
    }
  }

  return targetDatasetId
}

export function dataset<Env extends { orgId: string }>(env: Env) {
  const state: DatasetBuilderState<Env> = {
    env,
    sources: [],
    inferSchema: false,
    first: false,
  }

  const api = {
    fromFile(source: DatasetFileSourceInput) {
      state.sources.push({ kind: "file", ...source } as InternalSource)
      return api
    },

    fromText(source: DatasetTextSourceInput) {
      state.sources.push({ kind: "text", ...source } as InternalSource)
      return api
    },

    fromDataset(source: DatasetExistingSourceInput) {
      state.sources.push({ kind: "dataset", ...source } as InternalSource)
      return api
    },

    fromQuery<D extends DomainSchemaResult>(
      domain: D,
      source: Omit<DatasetQuerySourceInput<D>, "domain">,
    ) {
      state.sources.push({ kind: "query", domain, ...source } as InternalSource)
      return api
    },

    title(title: string) {
      state.title = title
      return api
    },

    sandbox(input: { sandboxId: string }) {
      state.sandboxId = String(input?.sandboxId ?? "").trim()
      return api
    },

    schema(schema: DatasetSchemaInput) {
      state.outputSchema = schema
      state.inferSchema = false
      return api
    },

    inferSchema() {
      state.outputSchema = undefined
      state.inferSchema = true
      return api
    },

    instructions(instructions: string) {
      state.instructions = instructions
      return api
    },

    reactor(reactor: ContextReactor<any, any>) {
      state.reactor = reactor
      return api
    },

    first() {
      state.first = true
      return api
    },

    async build(options?: { datasetId?: string }): Promise<DatasetBuildResult> {
      if (state.sources.length === 0) {
        throw new Error("dataset_sources_required")
      }

      const targetDatasetId = String(options?.datasetId ?? newId())
      const onlySource = state.sources[0]
      const isSingleSource = state.sources.length === 1
      const hasInstructions = Boolean(String(state.instructions ?? "").trim())

      if (isSingleSource && onlySource.kind === "query" && !hasInstructions) {
        await materializeQuerySource(state.env, onlySource, {
          datasetId: targetDatasetId,
          sandboxId: state.sandboxId,
          schema: state.outputSchema,
          title: state.title ?? onlySource.title,
          instructions: state.instructions,
          first: state.first,
        })
        return await finalizeBuildResult(state.env, targetDatasetId, state.first)
      }

      if (isSingleSource && (onlySource.kind === "file" || onlySource.kind === "text")) {
        if (!state.sandboxId) {
          throw new Error("dataset_sandbox_required")
        }
        if (!state.reactor) {
          throw new Error("dataset_reactor_required")
        }
        await materializeSingleFileLikeSource(state as any, onlySource as any, targetDatasetId)
        return await finalizeBuildResult(state.env, targetDatasetId, state.first)
      }

      if (!state.sandboxId) {
        throw new Error("dataset_sandbox_required")
      }
      if (!state.reactor) {
        throw new Error("dataset_reactor_required")
      }
      await materializeDerivedDataset(state as any, targetDatasetId)
      return await finalizeBuildResult(state.env, targetDatasetId, state.first)
    },
  }

  return api
}
