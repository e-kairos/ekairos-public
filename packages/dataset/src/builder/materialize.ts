import { createFileParseStory } from "../file/file-dataset.agent.js"
import { DatasetService } from "../service.js"
import { createTransformDatasetStory } from "../transform/transform-dataset.agent.js"
import {
  buildFileDefaultInstructions,
  buildRawSourceInstructions,
  buildTransformInstructions,
} from "./instructions.js"
import {
  createOrUpdateDatasetMetadata,
  getDatasetDb,
  materializeRowsToDataset,
  uploadInlineTextSource,
} from "./persistence.js"
import { inferDatasetSchema } from "./schemaInference.js"
import { getDomainDescriptor, normalizeQueryRows } from "./sourceRows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalSource,
} from "./types.js"

function makeIntermediateDatasetId(targetDatasetId: string, sourceKind: string, index: number) {
  return `${targetDatasetId}__${sourceKind}_${index}`
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
  const scoped = await (runtime as any).use(source.domain)
  const result = await (scoped.db as any).query(source.query as any)
  const rows = normalizeQueryRows(result)
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

export async function materializeSingleFileLikeSource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
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
      : await uploadInlineTextSource(state.runtime, targetDatasetId, source)

  await createOrUpdateDatasetMetadata(state.runtime, {
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
    const db = await getDatasetDb(state.runtime)
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
    const db = await getDatasetDb(state.runtime)
    const service = new DatasetService(db)
    const firstResult = await service.readOne(targetDatasetId)
    if (!firstResult.ok) {
      throw new Error(firstResult.error)
    }
  }

  return targetDatasetId
}

async function normalizeSourceToDatasetId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  source: InternalSource,
  targetDatasetId: string,
  sourceIndex: number,
) {
  if (source.kind === "dataset") {
    return source.datasetId
  }

  const intermediateDatasetId = makeIntermediateDatasetId(targetDatasetId, source.kind, sourceIndex)

  if (source.kind === "query") {
    await materializeQuerySource(state.runtime, source, {
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

export async function materializeDerivedDataset<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
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

  await createOrUpdateDatasetMetadata(state.runtime, {
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

  const db = await getDatasetDb(state.runtime)
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
