import { tool } from "ai"
import { z } from "zod"
import type { DomainSchemaResult } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import type { ContextReactor } from "@ekairos/events"
import { dataset, type DatasetSchemaInput } from "./dataset.js"
import { datasetDomain } from "./schema.js"

const fileSourceSchema = z.object({
  kind: z.literal("file"),
  fileId: z.string(),
  description: z.string().optional(),
})

const textSourceSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
})

const datasetSourceSchema = z.object({
  kind: z.literal("dataset"),
  datasetId: z.string(),
  description: z.string().optional(),
})

const querySourceSchema = z.object({
  kind: z.literal("query"),
  query: z.record(z.string(), z.any()),
  title: z.string().optional(),
  explanation: z.string().optional(),
})

const datasetSchemaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  schema: z.any(),
})

const materializeDatasetToolInputSchema = z.object({
  datasetId: z.string().optional(),
  sandboxId: z.string().optional(),
  title: z.string().optional(),
  sources: z
    .array(
      z.discriminatedUnion("kind", [
        fileSourceSchema,
        textSourceSchema,
        datasetSourceSchema,
        querySourceSchema,
      ]),
    )
    .min(1),
  instructions: z.string().optional(),
  mode: z.enum(["auto", "schema"]).optional(),
  output: z.enum(["rows", "object"]).optional(),
  schema: datasetSchemaSchema.optional(),
  first: z.boolean().optional(),
})

type MaterializeDatasetRuntimeEnv = { orgId: string }
type AnyMaterializeDatasetRuntime = EkairosRuntime<any, any, any>
type MaterializeDatasetRuntimeHandle<
  Runtime extends AnyMaterializeDatasetRuntime,
> = RuntimeForDomain<Runtime, typeof datasetDomain>

type CompatibleToolQueryDomain<
  Runtime extends AnyMaterializeDatasetRuntime,
  QueryDomain extends DomainSchemaResult,
> = RuntimeForDomain<Runtime, QueryDomain> extends never ? never : QueryDomain

export function createMaterializeDatasetTool<
  Runtime extends AnyMaterializeDatasetRuntime,
  QueryDomain extends DomainSchemaResult,
>(params: {
  runtime: Runtime & MaterializeDatasetRuntimeHandle<Runtime>
  reactor?: ContextReactor<any, any>
  queryDomain: QueryDomain & CompatibleToolQueryDomain<Runtime, QueryDomain>
  toolName?: string
}) {
  return tool({
    description:
      "Materialize a dataset from declarative sources. Returns only the target datasetId. Query sources use the preconfigured runtime domain.",
    inputSchema: materializeDatasetToolInputSchema,
    execute: async (input: {
      datasetId?: string
      sandboxId?: string
      title?: string
      sources: Array<
        | z.infer<typeof fileSourceSchema>
        | z.infer<typeof textSourceSchema>
        | z.infer<typeof datasetSourceSchema>
        | z.infer<typeof querySourceSchema>
      >
      instructions?: string
      mode?: "auto" | "schema"
      output?: "rows" | "object"
      schema?: DatasetSchemaInput
      first?: boolean
    }) => {
      let builder = dataset(params.runtime)

      if (input.title?.trim()) {
        builder = builder.title(input.title)
      }
      if (input.sandboxId?.trim()) {
        builder = builder.sandbox({ sandboxId: input.sandboxId })
      }

      for (const source of input.sources) {
        if (source.kind === "file") {
          builder = builder.fromFile(source)
          continue
        }
        if (source.kind === "text") {
          builder = builder.fromText(source)
          continue
        }
        if (source.kind === "dataset") {
          builder = builder.fromDataset(source)
          continue
        }
        builder = (builder as any).fromQuery(params.queryDomain, {
          query: source.query as any,
          title: source.title,
          explanation: source.explanation,
        })
      }

      if (input.output === "object") {
        builder = builder.asObject()
      } else {
        builder = builder.asRows()
      }

      if (input.schema) {
        builder = builder.schema(input.schema)
      } else if (input.mode === "auto" || input.mode === undefined) {
        builder = builder.inferSchema()
      }

      if (input.instructions?.trim()) {
        builder = builder.instructions(input.instructions)
      }

      if (input.first) {
        builder = builder.first()
      }

      if (params.reactor) {
        builder = builder.reactor(params.reactor)
      }

      const result = await builder.build({ datasetId: input.datasetId })
      return { datasetId: result.datasetId }
    },
  })
}

export { materializeDatasetToolInputSchema }
