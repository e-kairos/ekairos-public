import { tool } from "ai"
import { z } from "zod/v4"
import Ajv from "ajv"
import { structureGetContextStep } from "./dataset/steps.js"
import { readDatasetSandboxTextFileStep } from "./sandbox/steps.js"

let ajvInstance: Ajv | null = null

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false })
  }
  return ajvInstance
}

interface CompleteObjectToolParams {
  datasetId: string
  sandboxId: string
  env?: any
}

export function createCompleteObjectTool({ datasetId, sandboxId, env }: CompleteObjectToolParams) {
  return tool({
    description:
      "Complete an object result. Provide either resultJson (inline JSON) or resultPath (path to a JSON file in the sandbox). If a schema exists in the dataset record, the object is validated against it.",
    inputSchema: z
      .object({
        summary: z.string().describe("Short summary"),
        result: z.any().optional().describe("Result object (preferred)"),
        resultJson: z.string().optional().describe("JSON string for the result object"),
        resultPath: z.string().optional().describe("Sandbox path to a JSON file containing the object"),
      })
      .refine((v) => v.result !== undefined || Boolean(v.resultJson) || Boolean(v.resultPath), {
        message: "Provide result, resultJson or resultPath",
      }),
    execute: async (input: { summary: string; result?: any; resultJson?: string; resultPath?: string }) => {
      const contextKey = `structure:${datasetId}`
      const ctxResult = await structureGetContextStep({ env, contextKey })
      if (!ctxResult.ok) return { success: false, error: ctxResult.error }

      let obj: any
      if (input.result !== undefined) {
        obj = input.result
      } else {
        let jsonText = input.resultJson ?? ""
        if (!jsonText && input.resultPath) {
          const fileRead = await readDatasetSandboxTextFileStep({ env, sandboxId, path: input.resultPath })
          jsonText = fileRead.text ?? ""
        }

        try {
          obj = JSON.parse(jsonText)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { success: false, error: `Invalid JSON: ${message}` }
        }
      }

      const content = (ctxResult.data?.content ?? {}) as any
      const outputSchema = content?.structure?.outputSchema
      const mode = content?.structure?.mode
      // Schema validation is strict only in `.schema(...)` mode. Auto is best-effort.
      if (mode === "schema" && outputSchema?.schema) {
        try {
          const validator = getAjv().compile(outputSchema.schema)
          const valid = validator(obj)
          if (!valid) {
            const errors = Array.isArray(validator.errors)
              ? validator.errors.map((err) => err.message || "Unknown validation error")
              : ["Unknown validation error"]
            return { success: false, error: errors.slice(0, 5).join("; ") }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { success: false, error: `Failed to validate schema: ${message}` }
        }
      }

      return { success: true, summary: input.summary, result: obj }
    },
  })
}

