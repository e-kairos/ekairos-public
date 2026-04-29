import { createFileParseContext } from "../file/file-dataset.agent.js"
import { createTransformDatasetContext } from "../transform/transform-dataset.agent.js"
import {
  datasetInferAndUpdateSchemaStep,
  datasetReadOneStep,
} from "../dataset/steps.js"
import { registerDatasetAgentMaterializers } from "./agentMaterializers.js"
import {
  buildFileDefaultInstructions,
  buildRawSourceInstructions,
  buildTransformInstructions,
} from "./instructions.js"
import {
  createOrUpdateDatasetMetadata,
  uploadInlineTextSource,
} from "./persistence.js"
import { getDomainDescriptor } from "./sourceRows.js"
import { materializeQuerySource } from "./materializeQuery.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalSource,
} from "./types.js"

function makeIntermediateDatasetId(targetDatasetId: string, sourceKind: string, index: number) {
  return `${targetDatasetId}__${sourceKind}_${index}`
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

  const parseContext = createFileParseContext<typeof state.env>(fileId, {
    datasetId: targetDatasetId,
    instructions: state.instructions ?? buildFileDefaultInstructions(state.outputSchema),
    reactor: state.reactor as any,
    sandboxId: state.sandboxId,
  })

  await parseContext.parse(state.runtime as any, { durable: state.durable })

  if (!state.outputSchema) {
    await datasetInferAndUpdateSchemaStep({
      runtime: state.runtime,
      datasetId: targetDatasetId,
      title: `${targetDatasetId}Row`,
      description: "One dataset row",
    })
  }

  if (state.first) {
    await datasetReadOneStep({ runtime: state.runtime, datasetId: targetDatasetId })
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

  const transformContext = createTransformDatasetContext<typeof state.env>({
    sourceDatasetIds: normalizedSources,
    outputSchema: transformSchema,
    instructions: buildTransformInstructions(normalizedSources.length, state.instructions, state.outputSchema),
    datasetId: targetDatasetId,
    reactor: state.reactor as any,
    sandboxId: state.sandboxId,
  })

  await transformContext.transform(state.runtime as any, { durable: state.durable })

  if (!state.outputSchema) {
    await datasetInferAndUpdateSchemaStep({
      runtime: state.runtime,
      datasetId: targetDatasetId,
      title: `${targetDatasetId}Row`,
      description: "One dataset row",
    })
  }

  if (state.first) {
    await datasetReadOneStep({ runtime: state.runtime, datasetId: targetDatasetId })
  }

  return targetDatasetId
}

registerDatasetAgentMaterializers({
  materializeSingleFileLikeSource,
  materializeDerivedDataset,
})
