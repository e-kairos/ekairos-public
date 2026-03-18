import { tool } from "ai"
import { z } from "zod"
import type { DomainSchemaResult } from "@ekairos/domain"
import type { ContextReactor } from "@ekairos/events"
import { dataset, type DatasetSchemaInput } from "./dataset"

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
  sources: z.array(z.discriminatedUnion("kind", [
    fileSourceSchema,
    textSourceSchema,
    datasetSourceSchema,
    querySourceSchema,
  ])).min(1),
  instructions: z.string().optional(),
  schema: datasetSchemaSchema.optional(),
  first: z.boolean().optional(),
})

export function createMaterializeDatasetTool<Env extends { orgId: string }>(params: {
  env: Env
  reactor?: ContextReactor<any, any>
  queryDomain: DomainSchemaResult
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
      schema?: DatasetSchemaInput
      first?: boolean
    }) => {
      let builder = dataset(params.env)

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
        builder = builder.fromQuery(params.queryDomain, {
          query: source.query,
          title: source.title,
          explanation: source.explanation,
        })
      }

      if (input.schema) {
        builder = builder.schema(input.schema)
      } else {
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
