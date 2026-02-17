import { createThread, didToolExecute, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL } from "@ekairos/thread"
import { createDatasetSandboxStep, runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps"
import { createGenerateSchemaTool } from "./generateSchema.tool"
import { createCompleteDatasetTool } from "../completeDataset.tool"
import { createExecuteCommandTool } from "../executeCommand.tool"
import { createClearDatasetTool } from "../clearDataset.tool"
import { buildFileDatasetPrompt } from "./prompts"
import { generateFilePreview, FilePreviewContext, ensurePreviewScriptsAvailable } from "./filepreview"
import { id } from "@instantdb/admin"
import { getDatasetWorkstation } from "../datasetFiles"
import { readInstantFileStep } from "./steps"
import { datasetGetByIdStep } from "../dataset/steps"

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
    story: ReturnType<ReturnType<typeof createThread<Env>>["context"]> extends any ? any : any
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
 * Internamente corre un Story (`createThread("file.parse")`) que itera hasta que se ejecuta el tool `completeDataset`.
 */
function createFileParseStoryDefinition<Env extends { orgId: string }>(
    params: FileParseStoryParams
): { datasetId: string; story: any } {
    const datasetId = params.datasetId ?? id()
    const model = params.model ?? "openai/gpt-5"

    const story = createThread<Env>("file.parse")
        .context(async (stored: any, env: Env) => {
            const previous = (stored?.content as any) ?? {}
            const sandboxState: SandboxState = previous?.sandboxState ?? { initialized: false, filePath: "" }
            const existingSandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""

            let sandboxId = existingSandboxId
            if (!sandboxId) {
                const created = await createDatasetSandboxStep({ env, runtime: "python3.13", timeoutMs: 10 * 60 * 1000 })
                sandboxId = created.sandboxId
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
            return {
            executeCommand: createExecuteCommandTool({
                    datasetId,
                    sandboxId: (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? "",
                    env,
            }),
            generateSchema: createGenerateSchemaTool({
                    datasetId,
                    fileId: params.fileId,
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
                } as any
            })
            .shouldContinue(({ reactionEvent }: { reactionEvent: any }) => {
            return !didToolExecute(reactionEvent as any, "completeDataset")
        })
        .model(model)
        .build()

    return { datasetId, story }
}

/**
 * Factory (DX-first):
 *
 * Usage:
 *   const { datasetId } = await createFileParseStory(fileId, { instructions }).parse(env)
 *
 * - No `db` is accepted/stored (workflow-safe).
 * - All I/O happens in `"use step"` functions via Ekairos runtime (`getThreadRuntime(env).db`).
 * - `parse()` is the entrypoint; it calls `story.react(...)` internally.
 */
export function createFileParseStory<Env extends { orgId: string }>(
    fileId: string,
    opts?: {
        instructions?: string
        sandboxId?: string
        datasetId?: string
        model?: string
    },
) {
    const params: FileParseStoryParams = {
        fileId,
        instructions: opts?.instructions,
        sandboxId: opts?.sandboxId,
        datasetId: opts?.datasetId,
        model: opts?.model,
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

        await story.react(triggerEvent, {
                env: (env ?? ({} as any)) as Env,
                context: { key: `dataset:${datasetId}` },
            options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 20, maxModelSteps: 5 },
        })

            return { datasetId }
        },
        // Optional: expose the built story for advanced callers (not required for parse DX)
        story,
    }
}

