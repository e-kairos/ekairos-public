import { tool } from "ai"
import { z } from "zod"
import { datasetUpdateSchemaStep } from "../dataset/steps"


interface GenerateSchemaToolParams {
    datasetId: string
    isNested?: boolean
    fileId?: string
    env: any
}

export function createGenerateSchemaTool({ datasetId, isNested, fileId, env }: GenerateSchemaToolParams) {
    return tool({
        description: `Generate a formal JSON schema for a SINGLE RECORD (row) from the file. This schema describes the structure of ONE record, not the entire dataset or array of records. Requirements:
1. Schema describes ONE RECORD structure only (no array wrappers)
2. All property names MUST use lowercaseCamelCase convention (e.g., 'productName', 'unitPrice')
3. Each property MUST have a description field
4. The schema description must explain what one record represents and field mappings from original file`,
        inputSchema: z.object({
            schemaTitle: z.string().describe("Title for the RECORD schema in PascalCase (e.g., 'ProductRecord', 'TransactionRecord')"),
            schemaDescription: z.string().describe("Comprehensive description that includes: 1) what ONE record represents, 2) its purpose, 3) complete field mapping from original file fields to schema fields with explanations (e.g., 'ARTÍCULO' -> 'articleCode': normalized to camelCase)"),
            schemaJson: z.string().describe("Complete JSON schema as string describing ONE RECORD. Must be type 'object' with properties. All properties must be in lowercaseCamelCase and have descriptions. Do NOT use type 'array' at root level."),
        }),
        execute: async ({
            schemaTitle,
            schemaDescription,
            schemaJson,
        }: {
            schemaTitle: string
            schemaDescription: string
            schemaJson: string
        }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: generateSchema`)
            console.log(`[Dataset ${datasetId}] Title: ${schemaTitle}`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            try {
                const parsedSchema = JSON.parse(schemaJson)

                // Validate root schema is an object, not array
                if (parsedSchema.type === "array") {
                    console.error(`[Dataset ${datasetId}] Schema validation failed: Root type must be 'object', not 'array'`)
                    console.error(`[Dataset ${datasetId}] ========================================`)
                    return {
                        success: false,
                        error: "Schema must describe a SINGLE RECORD (type: 'object'), not an array. Remove array wrapper and describe just one record structure.",
                    }
                }

                // Validate schema conventions
                const validateSchema = (obj: any, path: string = ""): string[] => {
                    const errors: string[] = []
                    
                    if (obj.properties) {
                        for (const [key, value] of Object.entries(obj.properties)) {
                            // Check lowercaseCamelCase
                            if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
                                errors.push(`Property "${key}" at ${path} does not follow lowercaseCamelCase convention`)
                            }
                            
                            // Check description exists
                            const prop = value as any
                            if (!prop.description || prop.description.trim() === "") {
                                errors.push(`Property "${key}" at ${path} is missing description`)
                            }
                        }
                    }
                    
                    if (obj.items && obj.items.properties) {
                        errors.push(...validateSchema(obj.items, `${path}.items`))
                    }
                    
                    return errors
                }

                const validationErrors = validateSchema(parsedSchema)
                if (validationErrors.length > 0) {
                    console.error(`[Dataset ${datasetId}] Schema validation failed:`)
                    validationErrors.forEach(err => console.error(`  - ${err}`))
                    console.error(`[Dataset ${datasetId}] ========================================`)
                    return {
                        success: false,
                        error: `Schema validation failed: ${validationErrors.join("; ")}`,
                    }
                }

                const schemaData = {
                    title: schemaTitle,
                    description: schemaDescription,
                    schema: parsedSchema,
                    generatedAt: new Date().toISOString(),
                }

                console.log(`[Dataset ${datasetId}] ✅ Schema generated successfully`)
                console.log(`[Dataset ${datasetId}] Title: ${schemaTitle}`)
                console.log(`[Dataset ${datasetId}] Description: ${schemaDescription}`)
                console.log(`[Dataset ${datasetId}] Schema JSON:`)
                console.log(JSON.stringify(parsedSchema, null, 2))

                const updateResult = await datasetUpdateSchemaStep({
                    env,
                    datasetId,
                    schema: schemaData,
                    status: "schema_complete",
                })

                if (!updateResult.ok) {
                    console.error(`[Dataset ${datasetId}] Failed to update schema: ${updateResult.error}`)
                    console.error(`[Dataset ${datasetId}] ========================================`)
                    return {
                        success: false,
                        error: updateResult.error,
                    }
                }

                console.log(`[Dataset ${datasetId}] ========================================`)

                return {
                    success: true,
                    schema: schemaData,
                    message: "Schema generated successfully",
                }
            }
            catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error"
                console.error(`[Dataset ${datasetId}] generateSchema failed:`, errorMessage)
                console.error(`[Dataset ${datasetId}] ========================================`)
                return {
                    success: false,
                    error: errorMessage,
                }
            }
        },
    })
}

