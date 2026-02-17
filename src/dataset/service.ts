import { init, id as newId, InstantAdminDatabase } from "@instantdb/admin"
import { SchemaOf } from "../domain";
import { datasetDomain } from "./schema";
import { agentDomain } from "../agent/schema";


export type ServiceResult<T = any> = { ok: true; data: T } | { ok: false; error: string }

type DatasetSchemaType = SchemaOf<typeof datasetDomain> & SchemaOf<typeof agentDomain>;

export class DatasetService {
    private readonly db: InstantAdminDatabase<DatasetSchemaType>;

    constructor() {
        this.db = init({
            appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
            adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string, 
            schema: datasetDomain.schema() as DatasetSchemaType
        })
    }

    async createDataset(params: {
        id?: string
        sources?: string
        instructions?: string
        status?: string
        organizationId?: string
        [key: string]: any
    }): Promise<ServiceResult<{ datasetId: string }>> {
        try {
            const datasetId = params.id ?? newId()
            const mutations = []

            mutations.push(
                this.db.tx.dataset_datasets[datasetId].update({
                    sources: params.sources ?? "",
                    instructions: params.instructions ?? "",
                    status: params.status ?? "created",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    ...params,
                })
            )

            if (params.organizationId) {
                mutations.push(
                    this.db.tx.dataset_datasets[datasetId].link({
                        organization: params.organizationId,
                    })
                )
            }

            await this.db.transact(mutations)

            return { ok: true, data: { datasetId } }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async updateDataset(datasetId: string, updates: Record<string, any>): Promise<ServiceResult<void>> {
        try {
            await this.db.transact([
                this.db.tx.dataset_datasets[datasetId].update({
                    ...updates,
                    updatedAt: Date.now(),
                })
            ])

            return { ok: true, data: undefined }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async addDatasetRecords(params: {
        datasetId: string
        records: Array<{ rowContent: any; order: number }>
    }): Promise<ServiceResult<{ savedCount: number }>> {
        try {
            const mutations: any[] = []

            for (const record of params.records) {
                const recordId = newId()
                mutations.push(
                    this.db.tx.dataset_records[recordId].update({
                        rowContent: record.rowContent,
                        order: record.order,
                        createdAt: Date.now(),
                    }),
                    this.db.tx.dataset_datasets[params.datasetId].link({ records: [recordId] })
                )
            }

            if (mutations.length > 0) {
                await this.db.transact(mutations)
            }

            return { ok: true, data: { savedCount: params.records.length } }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async batchAddDatasetRecords(params: {
        datasetId: string
        shardMutations: any[]
        manifestMetadata?: any
    }): Promise<ServiceResult<void>> {
        try {
            const finalMutations = [...params.shardMutations]

            if (params.manifestMetadata) {
                finalMutations.push(
                    this.db.tx.dataset_datasets[params.datasetId].update({
                        status: "completed",
                        updatedAt: Date.now(),
                        actualGeneratedRowCount: params.manifestMetadata.totalRowsSaved ?? 0,
                    })
                )
            }

            if (finalMutations.length > 0) {
                await this.db.transact(finalMutations)
            }

            return { ok: true, data: undefined }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async findDatasetByFileId(fileId: string): Promise<any | null> {
        try {
            const lookupResult: any = await this.db.query({
                dataset_datasets: {
                    $: {
                        where: {
                            "files.id": fileId,
                        } as any,
                        limit: 1,
                    }
                },
            })

            return lookupResult.dataset_datasets?.[0] ?? null
        }
        catch (error) {
            console.error("Error finding dataset by file ID:", error)
            return null
        }
    }

    async findDatasetRecords(datasetId: string): Promise<any[]> {
        try {
            const datasetRecordQuery: any = await this.db.query({
                dataset_records: {
                    $: {
                        where: {
                            "dataset.id": datasetId,
                        } as any,
                        limit: 1,
                        fields: ["id"],
                    },
                },
            })

            return datasetRecordQuery.dataset_records ?? []
        }
        catch (error) {
            console.error("Error finding dataset records:", error)
            return []
        }
    }

    async getFileById(fileId: string): Promise<any> {
        try {
            const fileQuery: any = await this.db.query({
                $files: {
                    $: {
                        where: {
                            id: fileId
                        } as any,
                        limit: 1
                    }
                },
            })

            return fileQuery
        }
        catch (error) {
            console.error("Error getting file by ID:", error)
            throw error
        }
    }

    async getDatasetById(datasetId: string): Promise<ServiceResult<any>> {
        try {
            const query: any = await this.db.query({
                dataset_datasets: {
                    $: {
                        where: { id: datasetId },
                        limit: 1,
                    },
                },
            })

            const dataset = query.dataset_datasets?.[0]
            if (!dataset) {
                return { ok: false, error: `Dataset not found with id: ${datasetId}` }
            }

            return { ok: true, data: dataset }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async updateDatasetSchema(params: {
        datasetId: string
        schema: any
        status?: string
    }): Promise<ServiceResult<void>> {
        try {
            await this.db.transact([
                this.db.tx.dataset_datasets[params.datasetId].update({
                    schema: params.schema,
                    status: params.status ?? "schema_complete",
                    updatedAt: Date.now(),
                })
            ])

            return { ok: true, data: undefined }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async updateDatasetStatus(params: {
        datasetId: string
        status: string
        calculatedTotalRows?: number
        actualGeneratedRowCount?: number
    }): Promise<ServiceResult<void>> {
        try {
            const updates: any = {
                status: params.status,
                updatedAt: Date.now(),
            }

            if (params.calculatedTotalRows !== undefined) {
                updates.calculatedTotalRows = params.calculatedTotalRows
            }

            if (params.actualGeneratedRowCount !== undefined) {
                updates.actualGeneratedRowCount = params.actualGeneratedRowCount
            }

            await this.db.transact([
                this.db.tx.dataset_datasets[params.datasetId].update(updates)
            ])

            return { ok: true, data: undefined }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async getDatasetRecordsForDeletion(datasetId: string): Promise<ServiceResult<Array<{ id: string }>>> {
        try {
            const query: any = await this.db.query({
                dataset_records: {
                    $: {
                        where: {
                            "dataset.id": datasetId,
                        } as any,
                    },
                },
            })

            const records = query.dataset_records || []
            return { ok: true, data: records }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async deleteDatasetRecordsBatch(recordIds: string[]): Promise<ServiceResult<number>> {
        try {
            const tx: any[] = []
            for (const recordId of recordIds) {
                tx.push(this.db.tx.dataset_records[recordId].delete())
            }

            await this.db.transact(tx)
            return { ok: true, data: recordIds.length }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async clearDataset(datasetId: string): Promise<ServiceResult<{ deletedCount: number }>> {
        try {
            const recordsResult = await this.getDatasetRecordsForDeletion(datasetId)
            if (!recordsResult.ok) {
                return recordsResult
            }

            const records = recordsResult.data
            const BATCH_SIZE = 200
            let deletedCount = 0

            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE)
                const batchIds = batch.map((r) => r.id)
                const deleteResult = await this.deleteDatasetRecordsBatch(batchIds)

                if (!deleteResult.ok) {
                    return { ok: false, error: `Failed to delete batch at index ${i}: ${deleteResult.error}` }
                }

                deletedCount += deleteResult.data
            }

            const statusResult = await this.updateDatasetStatus({
                datasetId,
                status: "cleared",
                actualGeneratedRowCount: 0,
                calculatedTotalRows: 0,
            })

            if (!statusResult.ok) {
                return statusResult
            }

            return { ok: true, data: { deletedCount } }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async uploadDatasetOutputFile(params: {
        datasetId: string
        fileBuffer: Buffer
    }): Promise<ServiceResult<{ fileId: string; storagePath: string }>> {
        try {
            const storagePath = `/dataset/${params.datasetId}/output.jsonl`

            const uploadResult = await this.db.storage.uploadFile(storagePath, params.fileBuffer, {
                contentType: "application/x-ndjson",
                contentDisposition: "output.jsonl",
            })

            if (!uploadResult?.data?.id) {
                return { ok: false, error: "Failed to upload file to storage" }
            }

            const linkResult = await this.linkFileToDataset({
                datasetId: params.datasetId,
                fileId: uploadResult.data.id,
                storagePath,
            })

            if (!linkResult.ok) {
                return linkResult
            }

            return {
                ok: true,
                data: {
                    fileId: uploadResult.data.id,
                    storagePath,
                },
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async linkFileToDataset(params: {
        datasetId: string
        fileId: string
        storagePath: string
    }): Promise<ServiceResult<void>> {
        try {
            await this.db.transact([
                this.db.tx.dataset_datasets[params.datasetId].link({ dataFile: params.fileId }),
            ])

            return { ok: true, data: undefined }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async readRecordsFromFile(datasetId: string): Promise<ServiceResult<AsyncGenerator<any, void, unknown>>> {
        try {
            const fileQuery: any = await this.db.query({
                dataset_datasets: {
                    $: {
                        where: { id: datasetId },
                        limit: 1,
                    },
                    dataFile: {},
                } as any, // FIX TYPE ERROR
            })

            const datasetRecord = fileQuery.dataset_datasets?.[0]
            const dataFile = datasetRecord?.dataFile
            const linkedFile = Array.isArray(dataFile) ? dataFile[0] : dataFile

            if (!linkedFile || !linkedFile.url) {
                return { ok: false, error: "Dataset output file not found" }
            }

            async function* createGenerator(url: string): AsyncGenerator<any, void, unknown> {
                const response = await fetch(url)

                if (!response.ok || !response.body) {
                    throw new Error(`Failed to download dataset output file: ${response.status}`)
                }

                const reader = response.body.getReader()
                const decoder = new TextDecoder("utf-8")
                let buffer = ""

                while (true)
                {
                    const { value, done } = await reader.read()
                    if (done) {
                        break
                    }

                    buffer += decoder.decode(value, { stream: true })
                    let newlineIndex = buffer.indexOf("\n")

                    while (newlineIndex !== -1)
                    {
                        const line = buffer.slice(0, newlineIndex)
                        buffer = buffer.slice(newlineIndex + 1)

                        const trimmed = line.trim()
                        if (trimmed.length === 0) {
                            newlineIndex = buffer.indexOf("\n")
                            continue
                        }

                        let parsed: any
                        try {
                            parsed = JSON.parse(trimmed)
                        }
                        catch (error)
                        {
                            console.error("Invalid JSON line in dataset output", error)
                            newlineIndex = buffer.indexOf("\n")
                            continue
                        }

                        if (parsed && parsed.type === "row") {
                            yield { rowContent: parsed.data }
                        }

                        newlineIndex = buffer.indexOf("\n")
                    }
                }

                buffer += decoder.decode()
                const trimmed = buffer.trim()
                if (trimmed.length > 0) {
                    try {
                        const parsed = JSON.parse(trimmed)
                        if (parsed && parsed.type === "row") {
                            yield { rowContent: parsed.data }
                        }
                    }
                    catch (error)
                    {
                        console.error("Invalid JSON line in dataset output", error)
                    }
                }
            }

            const generator = createGenerator(linkedFile.url as string)
            return { ok: true, data: generator }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }

    async getContextByDatasetId(datasetId: string): Promise<ServiceResult<any>> {
        try {
            const query: any = await this.db.query({
                agent_contexts: {
                    $: {
                        where: { "content.datasetId": datasetId },
                        limit: 1,
                        order: { serverCreatedAt: "desc" },
                    } as any,
                },
            })

            const context = query.agent_contexts?.[0]
            if (!context) {
                return { ok: false, error: `Context not found for dataset: ${datasetId}` }
            }

            return { ok: true, data: context }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { ok: false, error: message }
        }
    }
}

