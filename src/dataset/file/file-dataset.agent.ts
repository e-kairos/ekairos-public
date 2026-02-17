import { Agent, AgentOptions, DataStreamWriter } from "../../agent/agent"
import { Tool } from "ai"
import { AgentService, ContextEvent, StoredContext } from "../../agent/service"
import { Sandbox } from "@vercel/sandbox"
import { createGenerateSchemaTool } from "./generateSchema.tool"
import { createCompleteDatasetTool } from "../completeDataset.tool"
import { createExecuteCommandTool } from "../executeCommand.tool"
import { createClearDatasetTool } from "../clearDataset.tool"
import { buildFileDatasetPrompt } from "./prompts"
import { generateFilePreview, FilePreviewContext, ensurePreviewScriptsAvailable } from "./filepreview"
import { id, init } from "@instantdb/admin"
import { USER_MESSAGE_TYPE, WEB_CHANNEL } from "../../agent"
import { getDatasetWorkstation } from "../datasetFiles"
import { DatasetService } from "../service"
import { datasetDomain } from "../schema"

export type FileDatasetContext = {
    datasetId: string
    fileId: string
    instructions: string
    sandboxConfig: {
        filePath: string
    }
    analysis: any[]
    schema: any | null
    plan: any | null
    executionResult: any | null
    errors: string[]
    iterationCount: number
    filePreview?: FilePreviewContext
}

export type FileDatasetAgentOptions = {
    fileId: string
    instructions: string
    sandbox: Sandbox
    service: DatasetService
} & AgentOptions

class InternalFileDatasetAgent extends Agent<FileDatasetContext> {
    private datasetId: string
    private fileId: string
    private instructions: string
    private sandbox: Sandbox
    private isSandboxInitialized: boolean = false
    private sandboxFilePath: string = ""
    private service: DatasetService

    constructor(opts: FileDatasetAgentOptions) {
        super(opts)
        this.datasetId = id()
        this.fileId = opts.fileId
        this.instructions = opts.instructions
        this.sandbox = opts.sandbox
        this.service = opts.service
    }

    public getDatasetId(): string {
        return this.datasetId
    }

    private async initializeSandbox(): Promise<string> {
        try {
            if (this.isSandboxInitialized) {
                return this.sandboxFilePath
            }

            console.log(`[FileDatasetAgent ${this.datasetId}] Initializing sandbox...`)

            await ensurePreviewScriptsAvailable(this.sandbox)

            console.log(`[FileDatasetAgent ${this.datasetId}] Installing Python dependencies...`)

            const pipInstall = await this.sandbox.runCommand({
                cmd: "python",
                args: ["-m", "pip", "install", "pandas", "openpyxl", "--quiet", "--upgrade"],
            })
            const installStderr = await pipInstall.stderr()

            if (installStderr && (installStderr.includes("ERROR") || installStderr.includes("FAILED"))) {
                throw new Error(`pip install failed: ${installStderr.substring(0, 300)}`)
            }

            console.log(`[FileDatasetAgent ${this.datasetId}] Fetching file from InstantDB...`)

            const fileQuery: any = await this.db.query({
                $files: { $: { where: { id: this.fileId } as any, limit: 1 } },
            })

            const fileRecord = fileQuery.$files?.[0]
            if (!fileRecord || !fileRecord.url) {
                throw new Error(`File not found: ${this.fileId}`)
            }

            console.log(`[FileDatasetAgent ${this.datasetId}] Creating dataset workstation...`)

            const workstation = getDatasetWorkstation(this.datasetId)
            await this.sandbox.runCommand({
                cmd: "mkdir",
                args: ["-p", workstation],
            })

            const fileBuffer = await fetch(fileRecord.url).then((response) => response.arrayBuffer())

            const fileName = fileRecord["content-disposition"]
            const fileExtension = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ""
            const sandboxFilePath = `${workstation}/${this.fileId}${fileExtension}`

            await this.sandbox.writeFiles([
                {
                    path: sandboxFilePath,
                    content: Buffer.from(fileBuffer),
                },
            ])

            console.log(`[FileDatasetAgent ${this.datasetId}] ✅ Workstation created: ${workstation}`)
            console.log(`[FileDatasetAgent ${this.datasetId}] ✅ File saved: ${sandboxFilePath}`)

            this.sandboxFilePath = sandboxFilePath
            this.isSandboxInitialized = true

            return sandboxFilePath
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error(`[FileDatasetAgent ${this.datasetId}] ❌ Failed to initialize sandbox:`, msg)
            throw error
        }
    }

    protected async initialize(context: StoredContext<FileDatasetContext>): Promise<FileDatasetContext> {

        const sandboxFilePath = await this.initializeSandbox()

        let filePreview: FilePreviewContext | undefined = undefined

        try {
            filePreview = await generateFilePreview(
                this.sandbox,
                sandboxFilePath,
                this.datasetId
            )
        }
        catch (error) {
            console.error(`[Dataset ${this.datasetId}] Failed to generate preview:`, error)
        }


        let schema: any | null = null
        const datasetResult = await this.service.getDatasetById(this.datasetId)
        if (datasetResult.ok && datasetResult.data.schema) {
            schema = datasetResult.data.schema
            console.log(`[FileDatasetAgent ${this.datasetId}] ✅ Schema loaded from database`)
        }
        else {
            console.log(`[FileDatasetAgent ${this.datasetId}] ℹ️  No schema found in database yet`)
        }

        return {
            datasetId: this.datasetId,
            fileId: this.fileId,
            instructions: this.instructions,
            sandboxConfig: {
                filePath: sandboxFilePath,
            },
            analysis: [],
            schema: schema,
            plan: null,
            executionResult: null,
            errors: [],
            iterationCount: 0,
            filePreview,
        }
    }

    protected async buildSystemPrompt(context: StoredContext<FileDatasetContext>): Promise<string> {
        console.log(`[FileDatasetAgent ${this.datasetId}] Building system prompt...`)
        console.log(`[FileDatasetAgent ${this.datasetId}] Schema present: ${!!context.content.schema}`)
        console.log(`[FileDatasetAgent ${this.datasetId}] ExecutionResult present: ${!!context.content.executionResult}`)
        console.log(`[FileDatasetAgent ${this.datasetId}] Iteration count: ${context.content.iterationCount}`)
        
        const prompt = buildFileDatasetPrompt(context.content)
        
        console.log(`[FileDatasetAgent ${this.datasetId}] Prompt length: ${prompt.length} chars`)
        
        return prompt
    }

    protected async buildTools(context: StoredContext<FileDatasetContext>, dataStream: DataStreamWriter): Promise<Record<string, Tool>> {
        const ctx = context.content

        return {
            executeCommand: createExecuteCommandTool({
                service: this.service,
                datasetId: ctx.datasetId,
                sandbox: this.sandbox,
            }),
            generateSchema: createGenerateSchemaTool({
                service: this.service,
                datasetId: ctx.datasetId,
                sandbox: this.sandbox,
                fileId: this.fileId,
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

    protected getModel(context: StoredContext<FileDatasetContext>): string {
        return "gpt-5-codex"
    }

    protected includeBaseTools(): { createMessage: boolean; requestDirection: boolean; end: boolean } {
        return { createMessage: false, requestDirection: false, end: false }
    }

    protected async getFinalizationToolNames(): Promise<string[]> {
        return ["completeDataset"]
    }

    protected async onEnd(lastEvent: ContextEvent): Promise<{ end: boolean }> {
        console.log(`[FileDatasetAgent ${this.datasetId}] On end called`)
        return { end: false } // dont stop on error, only when finished
    }

    protected async onToolCallExecuted(executionEvent: any): Promise<void> {
        console.log(`[FileDatasetAgent ${this.datasetId}] Tool call executed: ${executionEvent.toolCall.name}`)
    }
}

export type DatasetResult = {
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

export class FileDatasetAgent {
    private fileId: string
    private instructions: string
    private sandbox: Sandbox
    private service: DatasetService
    private agentService: AgentService

    constructor(params: { fileId: string; instructions: string; sandbox: Sandbox }) {
        this.fileId = params.fileId
        this.instructions = params.instructions
        this.sandbox = params.sandbox
        this.service = new DatasetService()
        this.agentService = new AgentService()
    }

    async getDataset(): Promise<DatasetResult> {
        const internalAgent = new InternalFileDatasetAgent({
            fileId: this.fileId,
            instructions: this.instructions,
            sandbox: this.sandbox,
            service: this.service,
        })

        const datasetId = internalAgent.getDatasetId()

        const userEvent = {
            id: id(),
            type: USER_MESSAGE_TYPE,
            channel: WEB_CHANNEL,
            content: {
                parts: [
                    {
                        type: "text",
                        text: "generate a dataset for this file",
                    },
                ],
            },
            createdAt: new Date().toISOString(),
        }

        const reaction = await internalAgent.reactStream(userEvent, null)
        const stream = reaction.stream
        const streamResult = await this.agentService.readEventStream(stream)

        if (streamResult.persistedEvent?.status !== "completed") {
            throw new Error(`Dataset generation failed with status: ${streamResult.persistedEvent?.status}`)
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

    async followUp(datasetId: string, feedback: string): Promise<DatasetResult> {
        const internalAgent = new InternalFileDatasetAgent({
            fileId: this.fileId,
            instructions: this.instructions,
            sandbox: this.sandbox,
            service: this.service,
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
            throw new Error(`Dataset iteration failed with status: ${streamResult.persistedEvent?.status}`)
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

