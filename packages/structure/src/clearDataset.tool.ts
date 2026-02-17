import { tool } from "ai"
import { z } from "zod/v4"
import { runDatasetSandboxCommandStep } from "./sandbox/steps.js"
import { getDatasetOutputPath } from "./datasetFiles.js"

interface ClearDatasetToolParams {
  datasetId: string
  sandboxId: string
  env?: any
}

export function createClearDatasetTool({ datasetId, sandboxId, env }: ClearDatasetToolParams) {
  return tool({
    description: "Clear output files and reset dataset status.",
    inputSchema: z.object({
      reason: z.string().describe("Reason for clearing"),
    }),
    execute: async ({ reason }: { reason: string }) => {
      const outputPath = getDatasetOutputPath(datasetId)

      try {
        await runDatasetSandboxCommandStep({ env, sandboxId, cmd: "rm", args: ["-f", outputPath] })
      } catch {
        // best-effort
      }

      return { success: true, message: "Cleared", reason }
    },
  })
}

