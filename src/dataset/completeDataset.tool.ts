import { tool } from "ai"
import { z } from "zod"
import { Sandbox } from "@vercel/sandbox"
import Ajv, { ValidateFunction } from "ajv"
import {
    getDatasetOutputPath,
} from "./datasetFiles"
import { DatasetService } from "./service"

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
    service: DatasetService
    datasetId: string
    sandbox: Sandbox
}

export function createCompleteDatasetTool({ service, datasetId, sandbox }: CompleteDatasetToolParams) {
    return tool({
        description: "Mark the dataset as completed. Use only when output.jsonl has been successfully generated and is ready for validation.",
        inputSchema: z.object({
            summary: z.string().describe("Summary of the completed dataset including record count and structure"),
        }),
        execute: async ({ summary }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: completeDataset`)
            console.log(`[Dataset ${datasetId}] Summary: ${summary}`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            const outputPath = getDatasetOutputPath(datasetId)

            try {
                await ensureFileExists(sandbox, outputPath)
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.error(`[Dataset ${datasetId}] Missing output file:`, message)
                return {
                    success: false,
                    error: message,
                }
            }

            console.log(`[Dataset ${datasetId}] Validating dataset rows against schema`)

            const datasetResult = await service.getDatasetById(datasetId)
            if (!datasetResult.ok) {
                console.error(`[Dataset ${datasetId}] ${datasetResult.error}`)
                return {
                    success: false,
                    error: datasetResult.error,
                }
            }

            const datasetRecord = datasetResult.data
            if (!datasetRecord.schema) {
                console.error(`[Dataset ${datasetId}] Schema not found in database`)
                return {
                    success: false,
                    error: "Schema not found in database. Please generate schema first.",
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
                    error: `Failed to compile schema: ${message}`,
                }
            }

            const validationResult = await validateJsonlRows({
                sandbox,
                outputPath,
                validator,
                datasetId,
            })

            if (!validationResult.success) {
                return validationResult
            }

            const totalValidRows = validationResult.validRowCount

            console.log(`[Dataset ${datasetId}] Reading file content for upload`)
            const fileStream = await sandbox.readFile({ path: outputPath })
            
            if (!fileStream) {
                console.error(`[Dataset ${datasetId}] Failed to read file`)
                return {
                    success: false,
                    error: "Failed to read file from sandbox",
                }
            }

            const chunks: Buffer[] = []
            for await (const chunk of fileStream as AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>) {
                if (typeof chunk === "string") {
                    chunks.push(Buffer.from(chunk, "utf-8"))
                } 
                else if (chunk instanceof Uint8Array) {
                    chunks.push(Buffer.from(chunk))
                } 
                else if (chunk instanceof ArrayBuffer) {
                    chunks.push(Buffer.from(chunk))
                } 
                else if (chunk) {
                    chunks.push(Buffer.from(chunk))
                }
            }

            if (chunks.length === 0) {
                console.error(`[Dataset ${datasetId}] Empty file content`)
                return {
                    success: false,
                    error: "Empty file content",
                }
            }

            const fileBuffer = Buffer.concat(chunks)

            console.log(`[Dataset ${datasetId}] Uploading file to InstantDB storage`)
            
            const uploadResult = await service.uploadDatasetOutputFile({
                datasetId,
                fileBuffer,
            })

            if (!uploadResult.ok) {
                console.error(`[Dataset ${datasetId}] File upload failed: ${uploadResult.error}`)
                return {
                    success: false,
                    error: uploadResult.error,
                }
            }

            console.log(`[Dataset ${datasetId}] File uploaded successfully: ${uploadResult.data.fileId}`)

            const statusResult = await service.updateDatasetStatus({
                datasetId,
                status: "completed",
                calculatedTotalRows: totalValidRows,
                actualGeneratedRowCount: totalValidRows,
            })

            if (!statusResult.ok) {
                console.error(`[Dataset ${datasetId}] Failed to update status: ${statusResult.error}`)
                return {
                    success: false,
                    error: statusResult.error,
                }
            }

            console.log(`[Dataset ${datasetId}] Dataset marked as COMPLETED (${totalValidRows} valid rows)`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            return {
                success: true,
                validRows: totalValidRows,
                fileId: uploadResult.data.fileId,
                storagePath: uploadResult.data.storagePath,
                message: "Dataset creation completed and uploaded to storage",
            }
        },
    })
}



async function ensureFileExists(sandbox: Sandbox, path: string): Promise<void> {
    const result = await sandbox.runCommand({
        cmd: "test",
        args: ["-f", path],
    })

    if (result.exitCode !== 0) {
        throw new Error(`Required file not found: ${path}`)
    }
}

interface ValidateJsonlRowsParams {
    sandbox: Sandbox
    outputPath: string
    validator: ValidateFunction
    datasetId: string
}

async function validateJsonlRows({ sandbox, outputPath, validator, datasetId }: ValidateJsonlRowsParams): Promise<{
    success: boolean
    validation?: Array<{ index: number; valid: boolean; errors?: string[] }>
    validRowCount?: number
    error?: string
}> {
    const validation: Array<{ index: number; valid: boolean; errors?: string[] }> = []
    let validRowCount = 0

    console.log(`[Dataset ${datasetId}] Reading and validating JSONL file from sandbox`)

    const fileStream = await sandbox.readFile({ path: outputPath })
    
    if (!fileStream) {
        console.log(`[Dataset ${datasetId}] Empty output file`)
        return {
            success: true,
            validation,
            validRowCount: 0,
        }
    }

    const chunks: Buffer[] = []
    for await (const chunk of fileStream as AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>) {
        if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk, "utf-8"))
        } 
        else if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk))
        } 
        else if (chunk instanceof ArrayBuffer) {
            chunks.push(Buffer.from(chunk))
        } 
        else if (chunk) {
            chunks.push(Buffer.from(chunk))
        }
    }

    if (chunks.length === 0) {
        console.log(`[Dataset ${datasetId}] Empty output file`)
        return {
            success: true,
            validation,
            validRowCount: 0,
        }
    }

    const fileContent = Buffer.concat(chunks).toString()
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
            continue
        }

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

    return {
        success: true,
        validation,
        validRowCount,
    }
}