import { createContext, didToolExecute, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL, type ContextReactor } from "@ekairos/events"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import { createGenerateSchemaTool } from "./generateSchema.tool.js"
import { createCompleteDatasetTool } from "../completeDataset.tool.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import { createClearDatasetTool } from "../clearDataset.tool.js"
import { buildFileDatasetPrompt } from "./prompts.js"
import { generateFilePreview, FilePreviewContext, ensurePreviewScriptsAvailable } from "./filepreview.js"
import { id } from "@instantdb/admin"
import { getDatasetWorkstation } from "../datasetFiles.js"
import { readInstantFileStep } from "./steps.js"
import { datasetGetByIdStep } from "../dataset/steps.js"
import { createEventsReactRuntime } from "../eventsReactRuntime.js"

export type FileParseStoryContext = {
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

export type FileParseStoryParams = {
    fileId: string
    instructions?: string
    sandboxId?: string
    datasetId?: string
    model?: string
    reactor?: ContextReactor<any, any>
}

// Sandbox initialization state (closure-based)
type SandboxState = {
    initialized: boolean
    filePath: string
}

async function initializeSandbox(
    env: any,
    sandboxId: string,
    datasetId: string,
    fileId: string,
    state: SandboxState
): Promise<string> {
    if (state.initialized) {
        return state.filePath
    }

    console.log(`[FileParseStory ${datasetId}] Initializing sandbox...`)

    await ensurePreviewScriptsAvailable(env, sandboxId)

    console.log(`[FileParseStory ${datasetId}] Installing Python dependencies...`)

    const pipInstall = await runDatasetSandboxCommandStep({
        env,
        sandboxId,
        cmd: "python",
        args: ["-m", "pip", "install", "pandas", "openpyxl", "--quiet", "--upgrade"],
    })
    const installStderr = pipInstall.stderr

    if (installStderr && (installStderr.includes("ERROR") || installStderr.includes("FAILED"))) {
        throw new Error(`pip install failed: ${installStderr.substring(0, 300)}`)
    }

    console.log(`[FileParseStory ${datasetId}] Fetching file from InstantDB...`)
    const file = await readInstantFileStep({ env, fileId })

    console.log(`[FileParseStory ${datasetId}] Creating dataset workstation...`)

    const workstation = getDatasetWorkstation(datasetId)
    await runDatasetSandboxCommandStep({
        env,
        sandboxId,
        cmd: "mkdir",
        args: ["-p", workstation],
    })

    const fileName = file.contentDisposition ?? ""
    const fileExtension = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ""
    const sandboxFilePath = `${workstation}/${fileId}${fileExtension}`

    await writeDatasetSandboxFilesStep({
        env,
        sandboxId,
        files: [
        {
            path: sandboxFilePath,
                contentBase64: file.contentBase64,
        },
        ],
    })

    console.log(`[FileParseStory ${datasetId}] ✅ Workstation created: ${workstation}`)
    console.log(`[FileParseStory ${datasetId}] ✅ File saved: ${sandboxFilePath}`)

    state.filePath = sandboxFilePath
    state.initialized = true

    return sandboxFilePath
}

export type FileParseStoryBuilder<Env extends { orgId: string }> = {
    datasetId: string
    story: ReturnType<ReturnType<typeof createContext<Env>>["context"]> extends any ? any : any
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
 * FileParseStory
 *
 * Uso:
 * - Crear una instancia con `fileId`, `instructions` y un `sandbox`
 * - Llamar `getDataset()` para crear un dataset nuevo (crea un datasetId interno)
 * - Llamar `followUp(datasetId, feedback)` para iterar el mismo dataset con feedback
 *
 * Internamente corre un Context (`createContext("file.parse")`) que itera hasta que se ejecuta el tool `completeDataset`.
 */
function createFileParseStoryDefinition<Env extends { orgId: string }>(
    params: FileParseStoryParams
): { datasetId: string; story: any } {
    const datasetId = params.datasetId ?? id()
    const model = params.model ?? "openai/gpt-5"

    let storyBuilder = createContext<Env>("file.parse")
        .context(async (stored: any, env: Env) => {
            const previous = (stored?.content as any) ?? {}
            const sandboxState: SandboxState = previous?.sandboxState ?? { initialized: false, filePath: "" }
            const sandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""
            if (!sandboxId) {
                throw new Error("dataset_sandbox_required")
            }

        const sandboxFilePath = await initializeSandbox(
                env,
                sandboxId,
            datasetId,
                params.fileId,
                sandboxState,
        )

        let filePreview: FilePreviewContext | undefined = undefined
        try {
                filePreview = await generateFilePreview(env, sandboxId, sandboxFilePath, datasetId)
        } catch {
                // optional
        }

        let schema: any | null = null
            const datasetResult = await datasetGetByIdStep({ env, datasetId })
            if (datasetResult.ok && datasetResult.data.schema) schema = datasetResult.data.schema

            const ctx: FileParseStoryContext = {
            datasetId,
                fileId: params.fileId,
                instructions: params.instructions ?? "",
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
                fileId: params.fileId,
                instructions: params.instructions ?? "",
                sandboxId,
                sandboxState,
                ctx,
            }
        })
        .narrative(async (stored: any) => {
            const ctx: FileParseStoryContext = stored?.content?.ctx
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
        .actions(async (_stored: any, env: Env) => {
            const existingSchema = (_stored?.content?.ctx?.schema as any)?.schema
            const actions: Record<string, any> = {
                executeCommand: createExecuteCommandTool({
                    datasetId,
                    sandboxId: (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? "",
                    env,
                }),
                completeDataset: createCompleteDatasetTool({
                    datasetId,
                    sandboxId: (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? "",
                    env,
                }),
                clearDataset: createClearDatasetTool({
                    datasetId,
                    sandboxId: (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? "",
                    env,
                }),
            }

            if (!existingSchema) {
                actions.generateSchema = createGenerateSchemaTool({
                    datasetId,
                    fileId: params.fileId,
                    env,
                })
            }

            return actions as any
        })
            .shouldContinue(({ reactionEvent }: { reactionEvent: any }) => {
            return !didToolExecute(reactionEvent as any, "completeDataset")
        })
        
    if (params.reactor) {
        storyBuilder = storyBuilder.reactor(params.reactor as any)
    } else {
        storyBuilder = storyBuilder.model(model)
    }

    const story = storyBuilder.build()

    return { datasetId, story }
}

/**
 * Factory (DX-first):
 *
 * Usage:
 *   const { datasetId } = await createFileParseStory(fileId, { instructions }).parse(env)
 *
 * - No `db` is accepted/stored (workflow-safe).
 * - All I/O happens in `"use step"` functions via Ekairos runtime (`getContextRuntime(env).db`).
 * - `parse()` is the entrypoint; it calls `story.react(...)` internally.
 */
export function createFileParseStory<Env extends { orgId: string }>(
    fileId: string,
    opts?: {
        instructions?: string
        sandboxId?: string
        datasetId?: string
        model?: string
        reactor?: ContextReactor<any, any>
    },
) {
    const params: FileParseStoryParams = {
        fileId,
        instructions: opts?.instructions,
        sandboxId: opts?.sandboxId,
        datasetId: opts?.datasetId,
        model: opts?.model,
        reactor: opts?.reactor,
    }
    const { datasetId, story } = createFileParseStoryDefinition<Env>(params)

    return {
        datasetId,
        async parse(env?: Env, prompt?: string): Promise<{ datasetId: string }> {
        const triggerEvent = {
            id: id(),
            type: INPUT_TEXT_ITEM_TYPE,
            channel: WEB_CHANNEL,
            createdAt: new Date().toISOString(),
            content: {
                    parts: [{ type: "text", text: prompt ?? "generate a dataset for this file" }],
            },
        } as any

        const runtime = createEventsReactRuntime((env ?? ({} as any)) as Env)
        const shell = await story.react(triggerEvent, {
                runtime,
                context: { key: `dataset:${datasetId}` },
                durable: false,
            options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 20, maxModelSteps: 5 },
        })
        await shell.run!

            return { datasetId }
        },
        // Optional: expose the built story for advanced callers (not required for parse DX)
        story,
    }
}

