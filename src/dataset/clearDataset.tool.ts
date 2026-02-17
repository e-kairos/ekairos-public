import { tool } from "ai"
import { z } from "zod"
import { Sandbox } from "@vercel/sandbox"
import { getDatasetOutputPath } from "./datasetFiles"
import { DatasetService } from "./service"

interface ClearDatasetToolParams {
    service: DatasetService
    datasetId: string
    sandbox: Sandbox
}

export function createClearDatasetTool({ service, datasetId, sandbox }: ClearDatasetToolParams) {
    return tool({
        description: "Clear all dataset records and output files. This will delete all generated data and reset the dataset to its initial state.",
        inputSchema: z.object({
            reason: z.string().describe("The reason for clearing the dataset"),
        }),
        execute: async ({ reason }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: clearDataset`)
            console.log(`[Dataset ${datasetId}] Reason: ${reason}`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            const outputPath = getDatasetOutputPath(datasetId)

            console.log(`[Dataset ${datasetId}] Step 1: Deleting output file`)
            try {
                const result = await sandbox.runCommand({
                    cmd: "rm",
                    args: ["-f", outputPath],
                })

                if (result.exitCode !== 0) {
                    const stderr = await result.stderr()
                    console.warn(`[Dataset ${datasetId}] Failed to delete output file: ${stderr}`)
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
            const clearResult = await service.clearDataset(datasetId)

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

