import { id as newId } from "@instantdb/admin"
import type { DomainInstantSchema, DomainSchemaResult } from "@ekairos/domain"
import type { ContextReactor } from "@ekairos/events"
import type { ValidQuery } from "@instantdb/core"

import { buildObjectOutputInstructions } from "./builder/instructions.js"
import {
  materializeDerivedDataset,
  materializeQuerySource,
  materializeSingleFileLikeSource,
} from "./builder/materialize.js"
import { finalizeBuildResult } from "./builder/persistence.js"
import type {
  AnyDatasetRuntime,
  CompatibleSourceDomain,
  DatasetBuilder,
  DatasetBuilderOptions,
  DatasetBuildOptions,
  DatasetBuildResult,
  DatasetBuilderState,
  DatasetExistingSourceInput,
  DatasetFileSourceInput,
  DatasetOutput,
  DatasetQuerySourceOptions,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetSourceInput,
  DatasetTextSourceInput,
  InternalSource,
} from "./builder/types.js"

export type {
  AnyDatasetRuntime,
  CompatibleSourceDomain,
  DatasetBuilder,
  DatasetBuilderOptions,
  DatasetBuildOptions,
  DatasetBuildResult,
  DatasetExistingSource,
  DatasetExistingSourceInput,
  DatasetFileSource,
  DatasetFileSourceInput,
  DatasetMode,
  DatasetOutput,
  DatasetQuerySourceInput,
  DatasetReader,
  DatasetReaderResult,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetTextSource,
  DatasetSourceInput,
  DatasetTextSourceInput,
} from "./builder/types.js"

export function dataset<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime & DatasetRuntimeHandle<Runtime>,
  options: DatasetBuilderOptions = {},
): DatasetBuilder<Runtime> {
  const datasetId = normalizeDatasetId(options.datasetId)
  const typedRuntime = runtime as Runtime
  const state: DatasetBuilderState<Runtime> = {
    runtime: typedRuntime,
    env: typedRuntime.env as Runtime["env"] & DatasetRuntimeEnv,
    sources: [],
    output: "rows",
    inferSchema: false,
    first: false,
  }

  const api: DatasetBuilder<Runtime> = {
    datasetId,

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

    from(...sources: DatasetSourceInput[]) {
      for (const source of sources) {
        if ("kind" in source) {
          state.sources.push(source as InternalSource)
          continue
        }
        if ("fileId" in source) {
          state.sources.push({ kind: "file", ...source } as InternalSource)
          continue
        }
        if ("datasetId" in source) {
          state.sources.push({ kind: "dataset", ...source } as InternalSource)
          continue
        }
        state.sources.push({ kind: "text", ...source } as InternalSource)
      }
      return api
    },

    fromQuery<
      D extends DomainSchemaResult,
      Q extends ValidQuery<Q, DomainInstantSchema<D>>,
    >(
      domain: CompatibleSourceDomain<Runtime, D>,
      source: DatasetQuerySourceOptions<D, Q>,
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

    auto() {
      state.outputSchema = undefined
      state.inferSchema = true
      return api
    },

    asRows() {
      state.output = "rows"
      return api
    },

    asObject() {
      state.output = "object"
      state.first = true
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

    async build(options?: DatasetBuildOptions): Promise<DatasetBuildResult> {
      if (state.sources.length === 0) {
        throw new Error("dataset_sources_required")
      }

      const targetDatasetId = options?.datasetId
        ? normalizeDatasetId(options.datasetId)
        : datasetId
      const effectiveState: DatasetBuilderState<Runtime> =
        state.output === "object"
          ? {
              ...state,
              first: true,
              instructions: buildObjectOutputInstructions(state.instructions),
            }
          : state
      const onlySource = effectiveState.sources[0]
      const isSingleSource = effectiveState.sources.length === 1
      const hasInstructions = Boolean(String(effectiveState.instructions ?? "").trim())

      if (isSingleSource && onlySource.kind === "query" && !hasInstructions) {
        await materializeQuerySource(effectiveState.runtime, onlySource, {
          datasetId: targetDatasetId,
          sandboxId: effectiveState.sandboxId,
          schema: effectiveState.outputSchema,
          title: effectiveState.title ?? onlySource.title,
          instructions: effectiveState.instructions,
          first: effectiveState.first,
        })
        return finalizeOutputResult(
          await finalizeBuildResult(effectiveState.runtime, targetDatasetId, effectiveState.first),
          effectiveState.output,
        )
      }

      if (isSingleSource && (onlySource.kind === "file" || onlySource.kind === "text")) {
        if (!effectiveState.sandboxId) {
          throw new Error("dataset_sandbox_required")
        }
        if (!effectiveState.reactor) {
          throw new Error("dataset_reactor_required")
        }
        await materializeSingleFileLikeSource(effectiveState, onlySource as any, targetDatasetId)
        return finalizeOutputResult(
          await finalizeBuildResult(effectiveState.runtime, targetDatasetId, effectiveState.first),
          effectiveState.output,
        )
      }

      if (!effectiveState.sandboxId) {
        throw new Error("dataset_sandbox_required")
      }
      if (!effectiveState.reactor) {
        throw new Error("dataset_reactor_required")
      }
      await materializeDerivedDataset(effectiveState, targetDatasetId)
      return finalizeOutputResult(
        await finalizeBuildResult(effectiveState.runtime, targetDatasetId, effectiveState.first),
        effectiveState.output,
      )
    },
  }

  return api
}

function normalizeDatasetId(datasetId?: string): string {
  const normalized = String(datasetId ?? newId()).trim()
  if (!normalized) {
    throw new Error("dataset_id_required")
  }
  return normalized
}

function finalizeOutputResult(result: DatasetBuildResult, output: DatasetOutput): DatasetBuildResult {
  if (output !== "object") return result
  return {
    ...result,
    object: result.firstRow ?? null,
  }
}
