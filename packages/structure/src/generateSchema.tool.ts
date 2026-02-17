import { tool } from "ai"
import { z } from "zod/v4"
import { writeDatasetSandboxTextFileStep } from "./sandbox/steps.js"
import { getDatasetOutputSchemaPath } from "./datasetFiles.js"

interface GenerateSchemaToolParams {
  datasetId: string
  sandboxId: string
  env?: any
}

export function createGenerateSchemaTool({ datasetId, sandboxId, env }: GenerateSchemaToolParams) {
  return tool({
    description:
      "Write the output JSON Schema to the sandbox so the story loop can lift it into context state. IMPORTANT: Field names must be lowerCamelCase. For rows output, schema should describe a single record. For object output, schema should describe the whole object.",
    inputSchema: z.object({
      schemaTitle: z.string().describe("Short schema title"),
      schemaDescription: z.string().describe("Short schema description"),
      schemaJson: z.string().describe("A JSON Schema string"),
    }),
    execute: async ({ schemaTitle, schemaDescription, schemaJson }: { schemaTitle: string; schemaDescription: string; schemaJson: string }) => {
      const schemaData = {
        title: schemaTitle,
        description: schemaDescription,
        schema: (() => {
          try {
            return JSON.parse(schemaJson)
          } catch (e) {
            throw e
          }
        })(),
      }

      const schemaPath = getDatasetOutputSchemaPath(datasetId)
      try {
        await writeDatasetSandboxTextFileStep({
          env,
          sandboxId,
          path: schemaPath,
          text: JSON.stringify(schemaData, null, 2),
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { success: false, error: message }
      }

      return { success: true, message: "Schema written", schemaPath }
    },
  })
}

