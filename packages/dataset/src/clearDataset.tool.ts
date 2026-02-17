import { tool } from "ai"
import { z } from "zod"
import { runDatasetSandboxCommandStep } from "./sandbox/steps"
import { getDatasetOutputPath } from "./datasetFiles"
import { datasetClearStep } from "./dataset/steps"

interface ClearDatasetToolParams {
    datasetId: string
    sandboxId: string
    env?: any
}

export function createClearDatasetTool({ datasetId, sandboxId, env }: ClearDatasetToolParams) {
    return tool({
        description: "Clear all dataset records and output files. This will delete all generated data and reset the dataset to its initial state.",
        inputSchema: z.object({
            reason: z.string().describe("The reason for clearing the dataset"),
        }),
        execute: async ({ reason }: { reason: string }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: clearDataset`)
            console.log(`[Dataset ${datasetId}] Reason: ${reason}`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            const outputPath = getDatasetOutputPath(datasetId)

            console.log(`[Dataset ${datasetId}] Step 1: Deleting output file`)
            try {
                const result = await runDatasetSandboxCommandStep({
                    env,
                    sandboxId,
                    cmd: "rm",
                    args: ["-f", outputPath],
                })

                if (result.exitCode !== 0) {
                    console.warn(`[Dataset ${datasetId}] Failed to delete output file: ${result.stderr}`)
                }
                else {
                    console.log(`[Dataset ${datasetId}] ✅ Output file deleted`)
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[Dataset ${datasetId}] Error deleting output file: ${message}`)
            }

            console.log(`[Dataset ${datasetId}] Step 2: Clearing dataset records`)
            const clearResult = await datasetClearStep({ env, datasetId })

            if (!clearResult.ok) {
                console.error(`[Dataset ${datasetId}] Failed to clear dataset: ${clearResult.error}`)
                return {
                    success: false,
                    error: clearResult.error,
                }
            }

            const deletedCount = clearResult.data.deletedCount
            console.log(`[Dataset ${datasetId}] ✅ Cleared ${deletedCount} records`)

            console.log(`[Dataset ${datasetId}] Dataset cleared successfully`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            return {
                success: true,
                deletedRecords: deletedCount,
                message: `Dataset cleared successfully. Deleted ${deletedCount} records and output files. Reason: ${reason}`,
            }
        },
    })
}

