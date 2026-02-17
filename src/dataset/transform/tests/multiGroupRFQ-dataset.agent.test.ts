import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { init } from "@instantdb/admin"
import { datasetDomain } from "../../schema"
import { FileDatasetAgent } from "../../file/file-dataset.agent"
import { TransformDatasetAgent } from "../transform-dataset.agent"
import { Sandbox } from "@vercel/sandbox"

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") })

const adminDb = init({
    appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
    adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
    schema: datasetDomain.schema(),
})

export async function createSandbox(): Promise<Sandbox> {
    const sandbox = await Sandbox.create({
        runtime: 'python3.13',
        timeout: 10 * 60 * 1000,
    })
    return sandbox
}

function buildGroupTransformSchema() {
    return {
        title: "MultiGroupRFQGroups",
        description: "Extracts normalized groups from the multi-group RFQ workbook",
        schema: {
            type: "object",
            additionalProperties: false,
            required: ["groups"],
            properties: {
                groups: {
                    type: "array",
                    description: "Groups detected in the RFQ file",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["groupId", "name", "deliveryMethod"],
                        properties: {
                            groupId: {
                                type: "string",
                                description: "Synthetic identifier generated during the transform",
                            },
                            name: {
                                type: "string",
                                description: "Human readable name for the group",
                            },
                            deliveryMethod: {
                                type: "string",
                                description: "Delivery modality associated with the group",
                            },
                            addressReference: {
                                anyOf: [
                                    {
                                        type: "null",
                                    },
                                    {
                                        type: "object",
                                        additionalProperties: false,
                                        required: ["id"],
                                        properties: {
                                            id: {
                                                type: "string",
                                                description: "Identifier that links the group with a known address",
                                            },
                                            name: {
                                                type: "string",
                                                description: "Address label if present in the source file",
                                            },
                                            formattedAddress: {
                                                type: "string",
                                                description: "Full formatted address if it can be inferred",
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        },
    }
}

function buildItemTransformSchema() {
    return {
        title: "MultiGroupRFQItems",
        description: "Extracts normalized items and group assignments from the multi-group RFQ workbook",
        schema: {
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
                items: {
                    type: "array",
                    description: "Items normalized from the RFQ file",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["itemCode", "description", "groupAssignments"],
                        properties: {
                            itemCode: {
                                type: "string",
                                description: "Unique item identifier or code",
                            },
                            description: {
                                type: "string",
                                description: "Item description detected in the source file",
                            },
                            unitOfMeasure: {
                                anyOf: [
                                    {
                                        type: "null",
                                    },
                                    {
                                        type: "string",
                                    },
                                ],
                                description: "Normalized unit of measure when available",
                            },
                            brand: {
                                anyOf: [
                                    {
                                        type: "null",
                                    },
                                    {
                                        type: "string",
                                    },
                                ],
                                description: "Brand metadata when it exists",
                            },
                            material: {
                                anyOf: [
                                    {
                                        type: "null",
                                    },
                                    {
                                        type: "string",
                                    },
                                ],
                                description: "Material metadata when it exists",
                            },
                            certification: {
                                anyOf: [
                                    {
                                        type: "null",
                                    },
                                    {
                                        type: "string",
                                    },
                                ],
                                description: "Certification metadata when it exists",
                            },
                            groupAssignments: {
                                type: "array",
                                minItems: 1,
                                description: "Assignments that link the item with the detected groups and requested quantities",
                                items: {
                                    type: "object",
                                    additionalProperties: false,
                                    required: ["groupId", "quantity"],
                                    properties: {
                                        groupId: {
                                            type: "string",
                                            description: "Identifier of the target group",
                                        },
                                        quantity: {
                                            type: "number",
                                            description: "Requested quantity for the group",
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    }
}

describe("Multi Group RFQ Dataset", () => {
    it("creates group and item datasets from the RFQ workbook using chained transforms", async () => {
        const workbookPath = path.resolve(__dirname, "complex-multi-group-rfq.xlsx")
        const workbookBuffer = await fs.readFile(workbookPath)
        const storagePath = `/tests/platform/${Date.now()}-${Math.random().toString(16).slice(2)}-multigroup.xlsx`

        const uploadResult = await adminDb.storage.uploadFile(storagePath, workbookBuffer, {
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            contentDisposition: "complex-multi-group-rfq.xlsx",
        })

        const uploadedFileId = uploadResult?.data?.id
        if (!uploadedFileId) {
            throw new Error("Workbook upload failed")
        }

        const sandbox = await createSandbox()

        try {
            const fileAgent = new FileDatasetAgent({
                fileId: uploadedFileId,
                instructions: "Ingest the multi-group RFQ workbook and produce the raw dataset output without transformations",
                sandbox,
            })

            const sourceDataset = await fileAgent.getDataset()

            expect(sourceDataset.id).toBeTruthy()
            expect(sourceDataset.schema).toBeTruthy()
            expect(sourceDataset.calculatedTotalRows).toBeGreaterThan(0)

            const groupTransformAgent = new TransformDatasetAgent({
                sourceDatasetIds: sourceDataset.id,
                outputSchema: buildGroupTransformSchema(),
                sandbox,
            })

            const groupsDataset = await groupTransformAgent.getDataset()

            expect(groupsDataset.id).toBeTruthy()
            expect(groupsDataset.schema).toBeTruthy()
            expect(groupsDataset.schema?.schema?.properties?.groups).toBeTruthy()

            const itemTransformAgent = new TransformDatasetAgent({
                sourceDatasetIds: [sourceDataset.id, groupsDataset.id],
                outputSchema: buildItemTransformSchema(),
                sandbox,
            })

            const itemsDataset = await itemTransformAgent.getDataset()

            expect(itemsDataset.id).toBeTruthy()
            expect(itemsDataset.schema).toBeTruthy()
            expect(itemsDataset.schema?.schema?.properties?.items).toBeTruthy()
        }
        finally {
            await sandbox.stop()
        }
    }, 180000000)
})