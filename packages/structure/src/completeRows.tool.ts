import { tool } from "ai"
import { z } from "zod/v4"
import Ajv, { ValidateFunction } from "ajv"
import { readDatasetSandboxFileStep, readDatasetSandboxTextFileStep, runDatasetSandboxCommandStep } from "./sandbox/steps.js"
import { getDatasetOutputPath } from "./datasetFiles.js"
import { structureGetContextStep, structureUploadRowsOutputJsonlStep } from "./dataset/steps.js"

let ajvInstance: Ajv | null = null

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false })
  }
  return ajvInstance
}

interface CompleteRowsToolParams {
  datasetId: string
  sandboxId: string
  env?: any
}

export function createCompleteRowsTool({ datasetId, sandboxId, env }: CompleteRowsToolParams) {
  return tool({
    description: "Complete a rows dataset. Requires output.jsonl in the workstation and a saved schema.",
    inputSchema: z.object({
      summary: z.string().describe("Summary of the completed dataset"),
    }),
    execute: async ({ summary }: { summary: string }) => {
      const contextKey = `structure:${datasetId}`
      const outputPath = getDatasetOutputPath(datasetId)

      try {
        await ensureFileExists(env, sandboxId, outputPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }

      const ctxResult = await structureGetContextStep({ env, contextKey })
      if (!ctxResult.ok) return { success: false, error: ctxResult.error }

      const content = (ctxResult.data?.content ?? {}) as any
      const outputSchema = content?.structure?.outputSchema
      if (!outputSchema?.schema) {
        return { success: false, error: "Schema not found in database. Please generate schema first." }
      }

      const schemaJson = outputSchema.schema
      const mode = content?.structure?.mode
      let validator: ValidateFunction | null = null
      try {
        validator = getAjv().compile(schemaJson)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (mode === "auto") {
          validator = null
        } else {
          return { success: false, error: `Failed to compile schema: ${message}` }
        }
      }

      let totalValidRows = 0
      if (validator) {
        const validationResult = await validateJsonlRows({ env, sandboxId, outputPath, validator })
        if (!validationResult.success) return validationResult
        totalValidRows = validationResult.validRowCount ?? 0
      }

      const fileRead = await readDatasetSandboxFileStep({ env, sandboxId, path: outputPath })
      if (!fileRead.contentBase64) return { success: false, error: "Empty file content" }

      const uploadResult = await structureUploadRowsOutputJsonlStep({
        env,
        structureId: datasetId,
        contentBase64: fileRead.contentBase64,
      })
      if (!uploadResult.ok) return { success: false, error: uploadResult.error }

      return {
        success: true,
        summary,
        validRows: totalValidRows,
        fileId: uploadResult.data.fileId,
        storagePath: uploadResult.data.storagePath,
      }
    },
  })
}

async function ensureFileExists(env: any, sandboxId: string, path: string): Promise<void> {
  const result = await runDatasetSandboxCommandStep({
    env,
    sandboxId,
    cmd: "test",
    args: ["-f", path],
  })
  if (result.exitCode !== 0) throw new Error("Required file not found")
}

async function validateJsonlRows(params: {
  env: any
  sandboxId: string
  outputPath: string
  validator: ValidateFunction
}): Promise<{ success: boolean; validRowCount?: number; error?: string }> {
  const { env, sandboxId, outputPath, validator } = params
  const fileRead = await readDatasetSandboxTextFileStep({ env, sandboxId, path: outputPath })
  const fileContent = fileRead.text ?? ""
  if (!fileContent) return { success: true, validRowCount: 0 }
  const lines = fileContent.split("\n")

  let validRowCount = 0
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (!trimmed) continue

    let record: any
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (record.type !== "row") continue
    const data = record.data
    if (data === undefined || data === null) continue

    const valid = validator(data)
    if (!valid) {
      const errors = Array.isArray(validator.errors)
        ? validator.errors.map((err) => err.message || "Unknown validation error")
        : ["Unknown validation error"]
      return { success: false, error: errors.slice(0, 3).join("; ") }
    }

    validRowCount++
  }

  return { success: true, validRowCount }
}

