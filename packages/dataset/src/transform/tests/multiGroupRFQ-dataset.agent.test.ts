import { it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { init } from "@instantdb/admin"
import { SandboxService } from "@ekairos/sandbox"
import { configureRuntime } from "@ekairos/domain/runtime"
import { domain } from "@ekairos/domain"
import { eventsDomain } from "@ekairos/events"
import { sandboxDomain } from "@ekairos/sandbox"
import { datasetDomain } from "../../schema"
import { createFileParseStory } from "../../file/file-dataset.agent"
import { createTransformDatasetStory } from "../transform-dataset.agent"
import { DatasetService } from "../../service"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "../../tests/_env"
import { attachMockInstantStreams } from "../../tests/_streams"

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") })

const appDomain = domain("dataset-transform-multi-group-rfq")
    .includes(datasetDomain)
    .includes(eventsDomain)
    .includes(sandboxDomain)
    .schema({
        entities: {},
        links: {},
        rooms: {},
    })

await setupInstantTestEnv("dataset-transform-multi-group-rfq", appDomain.toInstantSchema(), {
    preferExistingApp: false,
})

const registryVercelCwd = path.resolve(__dirname, "..", "..", "..", "registry")

const adminDb = hasInstantAdmin()
    ? init({
        appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
        adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
        schema: appDomain.toInstantSchema(),
      })
    : null as any

if (adminDb) {
    attachMockInstantStreams(adminDb)
}

if (adminDb) {
    configureRuntime({
        domain: { domain: appDomain },
        runtime: async () => ({ db: adminDb } as any),
    })
}

export async function createSandbox(): Promise<any> {
    const service = new SandboxService(adminDb as any)
    const created = await service.createSandbox({
        provider: "vercel",
        runtime: "python3.13",
        timeoutMs: 10 * 60 * 1000,
        purpose: "dataset.transform.tests",
        vercel: {
            cwd: registryVercelCwd,
            scope: "ekairos-dev",
            environment: "development",
        },
        env: { orgId: "test-org" },
        domain: appDomain,
        dataset: { enabled: true },
    })
    if (!created.ok) {
        throw new Error(created.error)
    }
    return {
        sandboxId: created.data.sandboxId,
        async stop() {
            await service.stopSandbox(created.data.sandboxId)
        },
    }
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

describeInstant("Multi Group RFQ Dataset", () => {
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
            const fileParse = createFileParseStory(uploadedFileId, {
                instructions: "Ingest the multi-group RFQ workbook and produce the raw dataset output without transformations",
                sandboxId: sandbox.sandboxId,
            })

            const datasetService = new DatasetService(adminDb as any)
            const seededSourceDataset = await datasetService.createDataset({
                id: fileParse.datasetId,
                status: "building",
                organizationId: "test-org",
                sandboxId: sandbox.sandboxId,
            })
            if (!seededSourceDataset.ok) {
                throw new Error(seededSourceDataset.error)
            }

            const parsed = await fileParse.parse({ orgId: "test-org" })
            const sourceDatasetResult = await datasetService.getDatasetById(parsed.datasetId)
            if (!sourceDatasetResult.ok) {
                throw new Error(sourceDatasetResult.error)
            }
            const sourceDataset = sourceDatasetResult.data

            expect(sourceDataset.id).toBeTruthy()
            expect(sourceDataset.schema).toBeTruthy()
            expect(sourceDataset.calculatedTotalRows).toBeGreaterThan(0)

            const groupTransform = createTransformDatasetStory({
                sourceDatasetIds: sourceDataset.id,
                outputSchema: buildGroupTransformSchema(),
                sandboxId: sandbox.sandboxId,
            })
            const seededGroupsDataset = await datasetService.createDataset({
                id: groupTransform.datasetId,
                status: "building",
                organizationId: "test-org",
                sandboxId: sandbox.sandboxId,
            })
            if (!seededGroupsDataset.ok) {
                throw new Error(seededGroupsDataset.error)
            }
            const groupsTransformResult = await groupTransform.transform({ orgId: "test-org" })
            const groupsDatasetResult = await datasetService.getDatasetById(groupsTransformResult.datasetId)
            if (!groupsDatasetResult.ok) {
                throw new Error(groupsDatasetResult.error)
            }
            const groupsDataset = groupsDatasetResult.data

            expect(groupsDataset.id).toBeTruthy()
            expect(groupsDataset.schema).toBeTruthy()
            expect(groupsDataset.schema?.schema?.properties?.groups).toBeTruthy()

            const itemTransform = createTransformDatasetStory({
                sourceDatasetIds: [sourceDataset.id, groupsDataset.id],
                outputSchema: buildItemTransformSchema(),
                sandboxId: sandbox.sandboxId,
            })
            const seededItemsDataset = await datasetService.createDataset({
                id: itemTransform.datasetId,
                status: "building",
                organizationId: "test-org",
                sandboxId: sandbox.sandboxId,
            })
            if (!seededItemsDataset.ok) {
                throw new Error(seededItemsDataset.error)
            }
            const itemsTransformResult = await itemTransform.transform({ orgId: "test-org" })
            const itemsDatasetResult = await datasetService.getDatasetById(itemsTransformResult.datasetId)
            if (!itemsDatasetResult.ok) {
                throw new Error(itemsDatasetResult.error)
            }
            const itemsDataset = itemsDatasetResult.data

            expect(itemsDataset.id).toBeTruthy()
            expect(itemsDataset.schema).toBeTruthy()
            expect(itemsDataset.schema?.schema?.properties?.items).toBeTruthy()
        }
        finally {
            await sandbox.stop()
        }
    }, 180000000)
})
