import { createContext, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL, type ContextReactor } from "@ekairos/events"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import { createGenerateSchemaTool } from "./generateSchema.tool.js"
import { createCompleteDatasetTool, didCompleteDatasetSucceed } from "../completeDataset.tool.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import { createClearDatasetTool } from "../clearDataset.tool.js"
import { buildFileDatasetPrompt } from "./prompts.js"
import { generateFilePreview, FilePreviewContext, ensurePreviewScriptsAvailable } from "./filepreview.js"
import { id } from "@instantdb/admin"
import { getDatasetWorkstation } from "../datasetFiles.js"
import { readInstantFileStep } from "./steps.js"
import { datasetGetByIdStep } from "../dataset/steps.js"

export type FileParseContext = {
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

export type FileParseContextParams = {
    fileId?: string
    instructions?: string
    sandboxId?: string
    datasetId?: string
    model?: string
    reactor?: ContextReactor<any, any>
}

export type FileParseRunOptions = {
    prompt?: string
    durable?: boolean
}

async function awaitContextRun(run: any) {
    if (!run) return
    if (run.returnValue) {
        await run.returnValue
        return
    }
    await run
}

// Sandbox initialization state (closure-based)
type SandboxState = {
    initialized: boolean
    filePath: string
}

async function initializeSandbox(
    runtime: any,
    sandboxId: string,
    datasetId: string,
    fileId: string,
    state: SandboxState
): Promise<string> {
    "use step"

    if (state.initialized) {
        return state.filePath
    }

    console.log(`[FileParseContext ${datasetId}] Initializing sandbox...`)

    await ensurePreviewScriptsAvailable(runtime, sandboxId)

    console.log(`[FileParseContext ${datasetId}] Installing Python dependencies...`)

    const pipInstall = await runDatasetSandboxCommandStep({
        runtime,
        sandboxId,
        cmd: "python",
        args: ["-m", "pip", "install", "pandas", "openpyxl", "--quiet", "--upgrade"],
    })
    const installStderr = pipInstall.stderr

    if (installStderr && (installStderr.includes("ERROR") || installStderr.includes("FAILED"))) {
        throw new Error(`pip install failed: ${installStderr.substring(0, 300)}`)
    }

    console.log(`[FileParseContext ${datasetId}] Fetching file from InstantDB...`)
    const file = await readInstantFileStep({ runtime, fileId })

    console.log(`[FileParseContext ${datasetId}] Creating dataset workstation...`)

    const workstation = getDatasetWorkstation(datasetId)
    await runDatasetSandboxCommandStep({
        runtime,
        sandboxId,
        cmd: "mkdir",
        args: ["-p", workstation],
    })

    const fileName = file.contentDisposition ?? ""
    const fileExtension = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ""
    const sandboxFilePath = `${workstation}/${fileId}${fileExtension}`

    await writeDatasetSandboxFilesStep({
        runtime,
        sandboxId,
        files: [
        {
            path: sandboxFilePath,
                contentBase64: file.contentBase64,
        },
        ],
    })

    console.log(`[FileParseContext ${datasetId}] ✅ Workstation created: ${workstation}`)
    console.log(`[FileParseContext ${datasetId}] ✅ File saved: ${sandboxFilePath}`)

    state.filePath = sandboxFilePath
    state.initialized = true

    return sandboxFilePath
}

export type FileParseContextBuilder<Env extends { orgId: string }> = {
    datasetId: string
    context: ReturnType<ReturnType<typeof createContext<Env>>["context"]> extends any ? any : any
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

/**
 * FileParseContext
 *
 * Uso:
 * - Crear una instancia con `fileId`, `instructions` y un `sandbox`
 * - Llamar `getDataset()` para crear un dataset nuevo (crea un datasetId interno)
 * - Llamar `followUp(datasetId, feedback)` para iterar el mismo dataset con feedback
 *
 * Internamente corre un Context (`createContext("file.parse")`) que itera hasta que se ejecuta el tool `completeDataset`.
 */
function createFileParseContextDefinition<Env extends { orgId: string }>(
    params: FileParseContextParams
): { datasetId: string; context: any } {
    const fallbackDatasetId = params.datasetId
    const model = params.model ?? "openai/gpt-5"

    let contextBuilder = createContext<Env>("file.parse")
        .context(async (stored: any, _env: Env, runtime: any) => {
            const previous = (stored?.content as any) ?? {}
            const sandboxState: SandboxState = previous?.sandboxState ?? { initialized: false, filePath: "" }
            const datasetId: string = previous?.datasetId ?? fallbackDatasetId ?? ""
            const fileId: string = previous?.fileId ?? params.fileId ?? ""
            const instructions: string = previous?.instructions ?? params.instructions ?? ""
            const sandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""
            if (!datasetId) {
                throw new Error("dataset_id_required")
            }
            if (!fileId) {
                throw new Error("dataset_file_id_required")
            }
            if (!sandboxId) {
                throw new Error("dataset_sandbox_required")
            }

        const sandboxFilePath = await initializeSandbox(
                runtime,
                sandboxId,
            datasetId,
                fileId,
                sandboxState,
        )

        let filePreview: FilePreviewContext | undefined = undefined
        try {
                filePreview = await generateFilePreview(runtime, sandboxId, sandboxFilePath, datasetId)
        } catch {
                // optional
        }

        let schema: any | null = null
            const datasetResult = await datasetGetByIdStep({ runtime, datasetId })
            if (datasetResult.ok && datasetResult.data.schema) schema = datasetResult.data.schema

            const ctx: FileParseContext = {
            datasetId,
                fileId,
                instructions,
            sandboxConfig: { filePath: sandboxFilePath },
            analysis: [],
            schema,
            plan: null,
            executionResult: null,
            errors: [],
            iterationCount: 0,
            filePreview,
        }

            return {
                ...previous,
                datasetId,
                fileId,
                instructions,
                sandboxId,
                sandboxState,
                ctx,
            }
        })
        .narrative(async (stored: any) => {
            const ctx: FileParseContext = stored?.content?.ctx
            const base = buildFileDatasetPrompt(ctx)
            const userInstructions = String(ctx?.instructions ?? "").trim()
            if (!userInstructions) return base

            return [
                "## USER INSTRUCTIONS",
                "The following instructions were provided by the user. Apply them in addition to (and with higher priority than) the default instructions.",
                "",
                userInstructions,
                "",
                base,
            ].join("\n")
        })
        .actions(async (_stored: any, _env: Env, runtime: any) => {
            const existingSchema = (_stored?.content?.ctx?.schema as any)?.schema
            const datasetId: string = _stored?.content?.datasetId ?? fallbackDatasetId ?? ""
            const fileId: string = _stored?.content?.fileId ?? params.fileId ?? ""
            const sandboxId: string = (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
            if (!datasetId) throw new Error("dataset_id_required")
            if (!fileId) throw new Error("dataset_file_id_required")
            if (!sandboxId) throw new Error("dataset_sandbox_required")
            const actions: Record<string, any> = {
                executeCommand: createExecuteCommandTool({
                    datasetId,
                    sandboxId,
                    runtime,
                }),
                completeDataset: createCompleteDatasetTool({
                    datasetId,
                    sandboxId,
                    runtime,
                }),
                clearDataset: createClearDatasetTool({
                    datasetId,
                    sandboxId,
                    runtime,
                }),
            }

            if (!existingSchema) {
                actions.generateSchema = createGenerateSchemaTool({
                    datasetId,
                    fileId,
                    runtime,
                })
            }

            return actions as any
        })
            .shouldContinue(({ reactionEvent }: { reactionEvent: any }) => {
            return !didCompleteDatasetSucceed(reactionEvent as any)
        })
        
    if (params.reactor) {
        contextBuilder = contextBuilder.reactor(params.reactor as any)
    } else {
        contextBuilder = contextBuilder.model(model)
    }

    const context = contextBuilder.build()

    return { datasetId: fallbackDatasetId ?? "", context }
}

/**
 * Factory (DX-first):
 *
 * Usage:
 *   const { datasetId } = await createFileParseContext(fileId, { instructions }).parse(runtime)
 *
 * - Uses the caller runtime; no secondary runtime is created.
 * - All I/O happens in `"use step"` functions via the provided Ekairos runtime.
 * - `parse()` is the entrypoint; it calls `context.react(...)` internally.
 */
export function createFileParseContext<Env extends { orgId: string }>(
    fileId: string,
    opts?: {
        instructions?: string
        sandboxId?: string
        datasetId?: string
        model?: string
        reactor?: ContextReactor<any, any>
    },
) {
    const datasetId = opts?.datasetId ?? id()
    const params: FileParseContextParams = {
        fileId,
        instructions: opts?.instructions,
        sandboxId: opts?.sandboxId,
        datasetId,
        model: opts?.model,
        reactor: opts?.reactor,
    }
    const { context } = createFileParseContextDefinition<Env>(params)

    return {
        datasetId,
        async parse(runtime: { env: Env }, options: FileParseRunOptions = {}): Promise<{ datasetId: string }> {
        const triggerEvent = {
            id: id(),
            type: INPUT_TEXT_ITEM_TYPE,
            channel: WEB_CHANNEL,
            createdAt: new Date().toISOString(),
            content: {
                    parts: [{ type: "text", text: options.prompt ?? "generate a dataset for this file" }],
            },
        } as any

        const shell = await context.react(triggerEvent, {
                runtime: runtime as any,
                context: { key: `dataset:${datasetId}` },
                durable: options.durable ?? false,
            options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 20, maxModelSteps: 5 },
            __initialContent: {
                datasetId,
                fileId,
                instructions: opts?.instructions ?? "",
                sandboxId: opts?.sandboxId ?? "",
                sandboxState: { initialized: false, filePath: "" },
            },
        })
        await awaitContextRun(shell.run)

            return { datasetId }
        },
        // Optional: expose the built context for advanced callers (not required for parse DX)
        context,
    }
}

export function registerFileParseContext<Env extends { orgId: string }>(
    opts?: {
        model?: string
        reactor?: ContextReactor<any, any>
    },
) {
    createFileParseContextDefinition<Env>({
        model: opts?.model,
        reactor: opts?.reactor,
    }).context
}

registerFileParseContext()
