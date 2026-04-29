import { tool } from "ai"
import { z } from "zod"
import { readDatasetSandboxFileStep, runDatasetSandboxCommandStep } from "./sandbox/steps.js"
import Ajv, { ValidateFunction } from "ajv"
import {
    getDatasetOutputPath,
} from "./datasetFiles.js"
import { datasetGetByIdStep, datasetUpdateStatusStep, datasetUploadOutputFileStep } from "./dataset/steps.js"

let ajvInstance: Ajv | null = null

function getAjv(): Ajv {
    if (!ajvInstance)
    {
        ajvInstance = new Ajv({
            allErrors: true,
            strict: false,
        })
    }
    return ajvInstance
}

interface CompleteDatasetToolParams {
    datasetId: string
    sandboxId: string
    runtime: any
}

export function createCompleteDatasetTool({ datasetId, sandboxId, runtime }: CompleteDatasetToolParams) {
    return tool({
        description: "Mark the dataset as completed. Use only when output.jsonl has been successfully generated and is ready for validation.",
        inputSchema: z.object({
            summary: z.string().describe("Summary of the completed dataset including record count and structure"),
        }),
        execute: async ({ summary }: { summary: string }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: completeDataset`)
            console.log(`[Dataset ${datasetId}] Summary: ${summary}`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            const outputPath = getDatasetOutputPath(datasetId)

            try {
                await ensureFileExists(runtime, sandboxId, outputPath)
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.error(`[Dataset ${datasetId}] Missing output file:`, message)
                return {
                    success: false,
                    status: "missing_output",
                    validRows: 0,
                    rowRecordCount: 0,
                    validation: [],
                    error: message,
                    message,
                }
            }

            console.log(`[Dataset ${datasetId}] Validating dataset rows against schema`)

            const datasetResult = await datasetGetByIdStep({ runtime, datasetId })
            if (!datasetResult.ok) {
                console.error(`[Dataset ${datasetId}] ${datasetResult.error}`)
                return {
                    success: false,
                    status: "dataset_not_found",
                    validRows: 0,
                    rowRecordCount: 0,
                    validation: [],
                    error: datasetResult.error,
                    message: datasetResult.error,
                }
            }

            const datasetRecord = datasetResult.data
            if (!datasetRecord.schema) {
                console.error(`[Dataset ${datasetId}] Schema not found in database`)
                return {
                    success: false,
                    status: "schema_missing",
                    validRows: 0,
                    rowRecordCount: 0,
                    validation: [],
                    error: "Schema not found in database. Please generate schema first.",
                    message: "Schema not found in database. Please generate schema first.",
                }
            }

            const schemaJson = datasetRecord.schema.schema

            let validator: ValidateFunction
            try {
                validator = getAjv().compile(schemaJson)
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.error(`[Dataset ${datasetId}] Failed to compile schema:`, message)
                return {
                    success: false,
                    status: "schema_invalid",
                    validRows: 0,
                    rowRecordCount: 0,
                    validation: [],
                    error: `Failed to compile schema: ${message}`,
                    message: `Failed to compile schema: ${message}`,
                }
            }

            const validationResult = await validateJsonlRows({
                runtime,
                sandboxId,
                outputPath,
                validator,
                datasetId,
            })

            if (!validationResult.success) {
                return validationResult
            }

            const totalValidRows = validationResult.validRowCount ?? 0
            const rowRecordCount = validationResult.rowRecordCount ?? totalValidRows

            console.log(`[Dataset ${datasetId}] Reading file content for upload`)
            const fileRead = await readDatasetSandboxFileStep({ runtime, sandboxId, path: outputPath })
            if (!fileRead.contentBase64) {
                console.error(`[Dataset ${datasetId}] Empty file content`)
                return {
                    success: false,
                    status: "empty_output",
                    validRows: 0,
                    rowRecordCount: 0,
                    validation: [],
                    error: "Empty file content",
                    message: "Empty file content",
                }
            }

            const fileBuffer = Buffer.from(fileRead.contentBase64, "base64")

            console.log(`[Dataset ${datasetId}] Uploading file to InstantDB storage`)
            
            const uploadResult = await datasetUploadOutputFileStep({ runtime, datasetId, fileBuffer })

            if (!uploadResult.ok) {
                console.error(`[Dataset ${datasetId}] File upload failed: ${uploadResult.error}`)
                return {
                    success: false,
                    status: "upload_failed",
                    validRows: totalValidRows,
                    rowRecordCount,
                    validation: validationResult.validation,
                    error: uploadResult.error,
                    message: uploadResult.error,
                }
            }

            console.log(`[Dataset ${datasetId}] File uploaded successfully: ${uploadResult.data.fileId}`)

            const statusResult = await datasetUpdateStatusStep({
                runtime,
                datasetId,
                status: "completed",
                calculatedTotalRows: totalValidRows,
                actualGeneratedRowCount: totalValidRows,
            })

            if (!statusResult.ok) {
                console.error(`[Dataset ${datasetId}] Failed to update status: ${statusResult.error}`)
                return {
                    success: false,
                    status: "status_update_failed",
                    validRows: totalValidRows,
                    rowRecordCount,
                    validation: validationResult.validation,
                    error: statusResult.error,
                    message: statusResult.error,
                }
            }

            console.log(`[Dataset ${datasetId}] Dataset marked as COMPLETED (${totalValidRows} valid rows)`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            return {
                success: true,
                status: "completed",
                validRows: totalValidRows,
                rowRecordCount,
                fileId: uploadResult.data.fileId,
                storagePath: uploadResult.data.storagePath,
                message: "Dataset creation completed and uploaded to storage",
            }
        },
    })
}

export function didCompleteDatasetSucceed(event: { content?: { parts?: any[] } }): boolean {
    const parts = Array.isArray(event?.content?.parts) ? event.content.parts : []

    return parts.some((part) => {
        if (part?.type === "action" && part?.content?.actionName === "completeDataset") {
            const output = part.content.output
            return part.content.status === "completed" && output?.success === true && output?.status === "completed"
        }

        if (part?.type === "tool-completeDataset") {
            const output = part.output ?? part.result
            return part.state === "output-available" && output?.success === true && output?.status === "completed"
        }

        return false
    })
}



async function ensureFileExists(runtime: any, sandboxId: string, path: string): Promise<void> {
    const result = await runDatasetSandboxCommandStep({
        runtime,
        sandboxId,
        cmd: "test",
        args: ["-f", path],
    })

    if (result.exitCode !== 0) {
        throw new Error(`Required file not found: ${path}`)
    }
}

interface ValidateJsonlRowsParams {
    runtime: any
    sandboxId: string
    outputPath: string
    validator: ValidateFunction
    datasetId: string
}

async function validateJsonlRows({ runtime, sandboxId, outputPath, validator, datasetId }: ValidateJsonlRowsParams): Promise<{
    success: boolean
    validation?: Array<{ index: number; valid: boolean; errors?: string[]; dataKeys?: string[] }>
    validRowCount?: number
    rowRecordCount?: number
    error?: string
    status?: string
    message?: string
}> {
    const validation: Array<{ index: number; valid: boolean; errors?: string[]; dataKeys?: string[] }> = []
    let validRowCount = 0
    let rowRecordCount = 0

    console.log(`[Dataset ${datasetId}] Reading and validating JSONL file from sandbox`)

    const fileRead = await readDatasetSandboxFileStep({ runtime, sandboxId, path: outputPath })
    if (!fileRead.contentBase64) {
        console.log(`[Dataset ${datasetId}] Empty output file`)
        return {
            success: false,
            status: "empty_output",
            validation,
            validRowCount: 0,
            rowRecordCount: 0,
            error: "output.jsonl is empty",
            message: "output.jsonl is empty",
        }
    }

    const fileContent = Buffer.from(fileRead.contentBase64, "base64").toString()
    const lines = fileContent.split("\n")
    console.log(`[Dataset ${datasetId}] Validating ${lines.length} lines`)

    for (let index = 0; index < lines.length; index++)
    {
        const line = lines[index]
        const trimmed = line.trim()
        if (trimmed.length === 0) {
            continue
        }

        let record: any
        try {
            record = JSON.parse(trimmed)
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            validation.push({
                index,
                valid: false,
                errors: [`Invalid JSON: ${message}`],
            })
            continue
        }

        if (record.type !== "row") {
            validation.push({
                index,
                valid: false,
                errors: ["Every non-empty output line must be a JSON object with type 'row'"],
            })
            continue
        }

        rowRecordCount++
        const data = record.data
        if (data === undefined || data === null) {
            validation.push({
                index,
                valid: false,
                errors: ["Missing 'data' field"],
            })
            continue
        }

        const valid = validator(data)
        if (!valid) {
            const errors = Array.isArray(validator.errors)
                ? validator.errors.map((err) => err.message || "Unknown validation error")
                : ["Unknown validation error"]
            validation.push({
                index,
                valid: false,
                errors,
                dataKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
            })
            continue
        }

        validation.push({
            index,
            valid: true,
        })
        validRowCount++
    }

    console.log(`[Dataset ${datasetId}] Validation completed: ${validRowCount} valid rows`)

    const invalidRows = validation.filter((entry) => !entry.valid)
    if (rowRecordCount === 0 || validRowCount === 0 || invalidRows.length > 0) {
        const message =
            rowRecordCount === 0
                ? "output.jsonl does not contain any type='row' records"
                : validRowCount === 0
                    ? "No dataset rows matched the stored schema"
                    : `${invalidRows.length} dataset row(s) failed schema validation`
        console.error(`[Dataset ${datasetId}] Validation failed: ${message}`)
        return {
            success: false,
            status: "validation_failed",
            validation,
            validRowCount,
            rowRecordCount,
            error: message,
            message,
        }
    }

    return {
        success: true,
        status: "completed",
        validation,
        validRowCount,
        rowRecordCount,
    }
}
