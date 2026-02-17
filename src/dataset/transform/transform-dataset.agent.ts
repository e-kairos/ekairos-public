import { Agent, AgentOptions, DataStreamWriter } from "../../agent/agent"
import { Tool } from "ai"
import { AgentService, ContextEvent, StoredContext } from "../../agent/service"
import { Sandbox } from "@vercel/sandbox"
import { createCompleteDatasetTool } from "../completeDataset.tool"
import { createExecuteCommandTool } from "../executeCommand.tool"
import { createClearDatasetTool } from "../clearDataset.tool"
import { buildTransformDatasetPrompt, TransformPromptContext } from "./prompts"
import { getDatasetWorkstation, getDatasetOutputPath } from "../datasetFiles"
import { id, init } from "@instantdb/admin"
import { USER_MESSAGE_TYPE, WEB_CHANNEL } from "../../agent"
import { DatasetService } from "../service"
import { generateSourcePreview, TransformSourcePreviewContext } from "./filepreview"

export type TransformDatasetContext = {
    datasetId: string
    sourceDatasetIds: string[]
    outputSchema: any
    sandboxConfig: {
        sourcePaths: Array<{ datasetId: string; path: string }>
        outputPath: string
    }
    sourcePreviews?: Array<{ datasetId: string; preview: TransformSourcePreviewContext }>
    errors: string[]
    iterationCount: number
    instructions?: string
}

export type TransformDatasetAgentOptions = {
    sourceDatasetIds: string[]
    outputSchema: any
    sandbox: Sandbox
    service: DatasetService
    instructions?: string
} & AgentOptions

class InternalTransformDatasetAgent extends Agent<TransformDatasetContext> {
    private datasetId: string
    private sourceDatasetIds: string[]
    private outputSchema: any
    private sandbox: Sandbox
    private service: DatasetService
    private instructions?: string
    private isSandboxInitialized: boolean = false
    private sandboxSourcePaths: Array<{ datasetId: string; path: string }> = []

    constructor(opts: TransformDatasetAgentOptions) {
        super(opts)
        this.datasetId = id()
        this.sourceDatasetIds = opts.sourceDatasetIds
        this.outputSchema = opts.outputSchema
        this.sandbox = opts.sandbox
        this.service = opts.service
        this.instructions = opts.instructions
    }

    public getDatasetId(): string {
        return this.datasetId
    }

    private async ensureSourcesInSandbox(): Promise<{ sourcePaths: Array<{ datasetId: string; path: string }>; outputPath: string }> {
        if (this.isSandboxInitialized) {
            return { sourcePaths: this.sandboxSourcePaths, outputPath: getDatasetOutputPath(this.datasetId) }
        }

        const workstation = getDatasetWorkstation(this.datasetId)

        await this.sandbox.runCommand({
            cmd: "mkdir",
            args: ["-p", workstation],
        })

        const sourcePaths: Array<{ datasetId: string; path: string }> = []

        for (const sourceDatasetId of this.sourceDatasetIds) {
            const existingSourcePath = getDatasetOutputPath(sourceDatasetId)
            const sourceExists = await this.sandbox.runCommand({
                cmd: "test",
                args: ["-f", existingSourcePath],
            })

            if (sourceExists.exitCode === 0) {
                sourcePaths.push({ datasetId: sourceDatasetId, path: existingSourcePath })
                continue
            }

            const storagePath = `/dataset/${sourceDatasetId}/output.jsonl`

            const fileQuery: any = await this.db.query({
                $files: {
                    $: {
                        where: { path: storagePath },
                        limit: 1,
                    },
                },
            })

            const fileRecord = Array.isArray(fileQuery.$files) ? fileQuery.$files[0] : undefined
            if (!fileRecord || !fileRecord.url) {
                throw new Error(`Source dataset output not found for datasetId=${sourceDatasetId}`)
            }

            const fileBuffer = await fetch(fileRecord.url).then((r) => r.arrayBuffer())
            const sourcePath = `${workstation}/source_${sourceDatasetId}.jsonl`

            await this.sandbox.writeFiles([
                {
                    path: sourcePath,
                    content: Buffer.from(fileBuffer),
                },
            ])

            sourcePaths.push({ datasetId: sourceDatasetId, path: sourcePath })
        }

        this.sandboxSourcePaths = sourcePaths
        this.isSandboxInitialized = true

        return { sourcePaths, outputPath: getDatasetOutputPath(this.datasetId) }
    }

    protected async initialize(context: StoredContext<TransformDatasetContext>): Promise<TransformDatasetContext> {
        const { sourcePaths, outputPath } = await this.ensureSourcesInSandbox()

        const sourcePreviews: Array<{ datasetId: string; preview: TransformSourcePreviewContext }> = []

        for (const sourcePathInfo of sourcePaths) {
            try {
                const preview = await generateSourcePreview(this.sandbox, sourcePathInfo.path, this.datasetId)
                sourcePreviews.push({ datasetId: sourcePathInfo.datasetId, preview })
            }
            catch (error) {
                console.error(`[TransformDatasetAgent ${this.datasetId}] Failed to generate source preview for ${sourcePathInfo.datasetId}:`, error)
            }
        }

        try {
            await this.service.updateDatasetSchema({
                datasetId: this.datasetId,
                schema: this.outputSchema,
                status: "schema_complete",
            })
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[TransformDatasetAgent ${this.datasetId}] Failed to persist output schema:`, message)
        }

        return {
            datasetId: this.datasetId,
            sourceDatasetIds: this.sourceDatasetIds,
            outputSchema: this.outputSchema,
            sandboxConfig: {
                sourcePaths: sourcePaths,
                outputPath: outputPath,
            },
            sourcePreviews: sourcePreviews.length > 0 ? sourcePreviews : undefined,
            errors: [],
            iterationCount: 0,
            instructions: this.instructions,
        }
    }

    protected async buildSystemPrompt(context: StoredContext<TransformDatasetContext>): Promise<string> {
        const promptContext: TransformPromptContext = {
            datasetId: context.content.datasetId,
            sourceDatasetIds: context.content.sourceDatasetIds,
            outputSchema: context.content.outputSchema,
            sandboxConfig: {
                sourcePaths: context.content.sandboxConfig.sourcePaths,
                outputPath: context.content.sandboxConfig.outputPath,
            },
            sourcePreviews: context.content.sourcePreviews,
            errors: context.content.errors,
        }
        let basePrompt = buildTransformDatasetPrompt(promptContext)
        
        // Append instructions if provided
        if (context.content.instructions) {
            basePrompt += `\n\n## ADDITIONAL CONTEXT AND INSTRUCTIONS\n\n${context.content.instructions}`
        }
        
        return basePrompt
    }

    protected async buildTools(context: StoredContext<TransformDatasetContext>, dataStream: DataStreamWriter): Promise<Record<string, Tool>> {
        const ctx = context.content

        return {
            executeCommand: createExecuteCommandTool({
                service: this.service,
                datasetId: ctx.datasetId,
                sandbox: this.sandbox,
            }),
            completeDataset: createCompleteDatasetTool({
                service: this.service,
                datasetId: ctx.datasetId,
                sandbox: this.sandbox,
            }),
            clearDataset: createClearDatasetTool({
                service: this.service,
                datasetId: ctx.datasetId,
                sandbox: this.sandbox,
            }),
        }
    }

    protected getModel(_context: StoredContext<TransformDatasetContext>): string {
        return "gpt-5-codex"
    }

    protected includeBaseTools(): { createMessage: boolean; requestDirection: boolean; end: boolean } {
        return { createMessage: false, requestDirection: false, end: false }
    }

    protected async getFinalizationToolNames(): Promise<string[]> {
        return ["completeDataset"]
    }

    protected async onEnd(_lastEvent: ContextEvent): Promise<{ end: boolean }> {
        return { end: false }
    }

    protected async onToolCallExecuted(executionEvent: any): Promise<void> {
        try {
            const name = executionEvent?.toolCall?.toolName || executionEvent?.toolCall?.name || "unknown"
            console.log(`[TransformDatasetAgent ${this.datasetId}] Tool call executed: ${name}`)
        }
        catch { }
    }
}

export type TransformDatasetResult = {
    id: string
    status?: string
    title?: string
    schema?: any
    analysis?: any
    calculatedTotalRows?: number
    actualGeneratedRowCount?: number
    createdAt?: number
    updatedAt?: number
}

export class TransformDatasetAgent {
    private sourceDatasetIds: string[]
    private outputSchema: any
    private sandbox: Sandbox
    private service: DatasetService
    private agentService: AgentService
    private instructions?: string

    constructor(params: { sourceDatasetIds: string | string[]; outputSchema: any; sandbox: Sandbox; instructions?: string }) {
        this.sourceDatasetIds = Array.isArray(params.sourceDatasetIds) ? params.sourceDatasetIds : [params.sourceDatasetIds]
        this.outputSchema = params.outputSchema
        this.sandbox = params.sandbox
        this.service = new DatasetService()
        this.agentService = new AgentService()
        this.instructions = params.instructions
    }

    async getDataset(): Promise<TransformDatasetResult> {
        const internalAgent = new InternalTransformDatasetAgent({
            sourceDatasetIds: this.sourceDatasetIds,
            outputSchema: this.outputSchema,
            sandbox: this.sandbox,
            service: this.service,
            instructions: this.instructions,
        })

        const datasetId = internalAgent.getDatasetId()

        const datasetCountText = this.sourceDatasetIds.length === 1 
            ? "the source dataset" 
            : `${this.sourceDatasetIds.length} source datasets`

        const userEvent = {
            id: id(),
            type: USER_MESSAGE_TYPE,
            channel: WEB_CHANNEL,
            content: {
                parts: [
                    {
                        type: "text",
                        text: `Transform ${datasetCountText} into a new dataset matching the provided output schema`,
                    },
                ],
            },
            createdAt: new Date().toISOString(),
        }

        const reaction = await internalAgent.reactStream(userEvent, null)
        const stream = reaction.stream
        const streamResult = await this.agentService.readEventStream(stream)

        if (streamResult.persistedEvent?.status !== "completed") {
            throw new Error(`Dataset transformation failed with status: ${streamResult.persistedEvent?.status}`)
        }

        const datasetResult = await this.service.getDatasetById(datasetId)
        if (!datasetResult.ok) {
            throw new Error(datasetResult.error)
        }

        const dataset = datasetResult.data

        return {
            id: dataset.id,
            status: dataset.status,
            title: dataset.title,
            schema: dataset.schema,
            analysis: dataset.analysis,
            calculatedTotalRows: dataset.calculatedTotalRows,
            actualGeneratedRowCount: dataset.actualGeneratedRowCount,
            createdAt: dataset.createdAt,
            updatedAt: dataset.updatedAt,
        }
    }

    async followUp(datasetId: string, feedback: string): Promise<TransformDatasetResult> {
        const internalAgent = new InternalTransformDatasetAgent({
            sourceDatasetIds: this.sourceDatasetIds,
            outputSchema: this.outputSchema,
            sandbox: this.sandbox,
            service: this.service,
            instructions: this.instructions,
        })

        const userEvent = {
            id: id(),
            type: USER_MESSAGE_TYPE,
            channel: WEB_CHANNEL,
            content: {
                parts: [
                    {
                        type: "text",
                        text: feedback,
                    },
                ],
            },
            createdAt: new Date().toISOString(),
        }

        const contextResult = await this.service.getContextByDatasetId(datasetId)
        if (!contextResult.ok) {
            throw new Error(contextResult.error)
        }

        const contextId = contextResult.data.id

        const reaction = await internalAgent.reactStream(userEvent, { id: contextId })
        const stream = reaction.stream
        const streamResult = await this.agentService.readEventStream(stream)

        if (streamResult.persistedEvent?.status !== "completed") {
            throw new Error(`Dataset transformation iteration failed with status: ${streamResult.persistedEvent?.status}`)
        }

        const datasetResult = await this.service.getDatasetById(datasetId)
        if (!datasetResult.ok) {
            throw new Error(datasetResult.error)
        }

        const dataset = datasetResult.data

        return {
            id: dataset.id,
            status: dataset.status,
            title: dataset.title,
            schema: dataset.schema,
            analysis: dataset.analysis,
            calculatedTotalRows: dataset.calculatedTotalRows,
            actualGeneratedRowCount: dataset.actualGeneratedRowCount,
            createdAt: dataset.createdAt,
            updatedAt: dataset.updatedAt,
        }
    }
}


