import type { InstaQLParams, ValidQuery } from "@instantdb/core"
import type { DomainInstantSchema, DomainSchemaResult } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import type { ContextReactor } from "@ekairos/events"

import { datasetDomain } from "../schema"

export type DatasetQuerySourceInput<D extends DomainSchemaResult = DomainSchemaResult> = {
  query: InstaQLParams<DomainInstantSchema<D>>
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

export type DatasetFileSource = { kind: "file" } & DatasetFileSourceInput
export type DatasetTextSource = { kind: "text" } & DatasetTextSourceInput
export type DatasetExistingSource = { kind: "dataset" } & DatasetExistingSourceInput

export type DatasetSourceInput =
  | DatasetFileSourceInput
  | DatasetTextSourceInput
  | DatasetExistingSourceInput
  | DatasetFileSource
  | DatasetTextSource
  | DatasetExistingSource

export type DatasetSchemaInput = {
  title?: string
  description?: string
  schema: any
}

export type DatasetOutput = "rows" | "object"
export type DatasetMode = "auto" | "schema"

export type DatasetBuilderOptions = {
  datasetId?: string
}

export type DatasetBuildOptions = {
  datasetId?: string
}

export type InternalSource =
  | DatasetFileSource
  | DatasetTextSource
  | DatasetExistingSource
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
  object?: any | null
  firstRow?: any | null
}

export type DatasetRuntimeEnv = { orgId: string }
export type AnyDatasetRuntime = EkairosRuntime<any, any, any>
export type DatasetRuntimeHandle<Runtime extends AnyDatasetRuntime> = RuntimeForDomain<
  Runtime,
  typeof datasetDomain
>
export type CompatibleSourceDomain<
  Runtime extends AnyDatasetRuntime,
  D extends DomainSchemaResult,
> = RuntimeForDomain<Runtime, D> extends never ? never : D

export type DatasetQuerySourceOptions<
  D extends DomainSchemaResult,
  Q extends ValidQuery<Q, DomainInstantSchema<D>>,
> = {
  query: Q
  title?: string
  explanation?: string
}

export type DatasetBuilderState<Runtime extends AnyDatasetRuntime> = {
  runtime: Runtime
  env: Runtime["env"] & DatasetRuntimeEnv
  sources: InternalSource[]
  title?: string
  sandboxId?: string
  outputSchema?: DatasetSchemaInput
  output: DatasetOutput
  inferSchema: boolean
  instructions?: string
  reactor?: ContextReactor<any, any>
  first: boolean
}

export type MaterializeRowsParams = {
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

export type DatasetBuilder<Runtime extends AnyDatasetRuntime> = {
  readonly datasetId: string

  fromFile(source: DatasetFileSourceInput): DatasetBuilder<Runtime>
  fromText(source: DatasetTextSourceInput): DatasetBuilder<Runtime>
  fromDataset(source: DatasetExistingSourceInput): DatasetBuilder<Runtime>
  from(...sources: DatasetSourceInput[]): DatasetBuilder<Runtime>
  fromQuery<
    D extends DomainSchemaResult,
    Q extends ValidQuery<Q, DomainInstantSchema<D>>,
  >(
    domain: D & CompatibleSourceDomain<Runtime, D>,
    source: DatasetQuerySourceOptions<D, Q>,
  ): DatasetBuilder<Runtime>

  title(title: string): DatasetBuilder<Runtime>
  sandbox(input: { sandboxId: string }): DatasetBuilder<Runtime>
  schema(schema: DatasetSchemaInput): DatasetBuilder<Runtime>
  inferSchema(): DatasetBuilder<Runtime>
  auto(): DatasetBuilder<Runtime>
  asRows(): DatasetBuilder<Runtime>
  asObject(): DatasetBuilder<Runtime>
  instructions(instructions: string): DatasetBuilder<Runtime>
  reactor(reactor: ContextReactor<any, any>): DatasetBuilder<Runtime>
  first(): DatasetBuilder<Runtime>
  build(options?: DatasetBuildOptions): Promise<DatasetBuildResult>
}
