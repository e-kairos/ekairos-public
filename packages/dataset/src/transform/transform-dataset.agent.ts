import { createContext, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL, type ContextReactor } from "@ekairos/events"
import { createCompleteDatasetTool, didCompleteDatasetSucceed } from "../completeDataset.tool.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import { createClearDatasetTool } from "../clearDataset.tool.js"
import { buildTransformDatasetPrompt, TransformPromptContext } from "./prompts.js"
import { getDatasetWorkstation, getDatasetOutputPath } from "../datasetFiles.js"
import { id } from "@instantdb/admin"
import { generateSourcePreview, TransformSourcePreviewContext } from "./filepreview.js"
import { datasetReadOutputJsonlStep, datasetUpdateSchemaStep } from "../dataset/steps.js"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"

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

export type TransformDatasetAgentParams = {
    sourceDatasetIds: string[]
    outputSchema: any
    instructions?: string
    datasetId?: string
    model?: string
    sandboxId?: string
    reactor?: ContextReactor<any, any>
}

export type TransformDatasetRunOptions = {
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
type TransformSandboxState = {
    initialized: boolean
    sourcePaths: Array<{ datasetId: string; path: string }>
}

async function ensureSourcesInSandbox(
    runtime: any,
    sandboxId: string,
    datasetId: string,
    sourceDatasetIds: string[],
    state: TransformSandboxState
): Promise<{ sourcePaths: Array<{ datasetId: string; path: string }>; outputPath: string }> {
    if (state.initialized) {
        return { sourcePaths: state.sourcePaths, outputPath: getDatasetOutputPath(datasetId) }
    }

    const workstation = getDatasetWorkstation(datasetId)

    await runDatasetSandboxCommandStep({ runtime, sandboxId, cmd: "mkdir", args: ["-p", workstation] })

    const sourcePaths: Array<{ datasetId: string; path: string }> = []

    for (const sourceDatasetId of sourceDatasetIds) {
        const sourcePath = `${workstation}/source_${sourceDatasetId}.jsonl`

        const source = await datasetReadOutputJsonlStep({ runtime, datasetId: sourceDatasetId })
        await writeDatasetSandboxFilesStep({
            runtime,
            sandboxId,
            files: [{ path: sourcePath, contentBase64: source.contentBase64 }],
        })

        sourcePaths.push({ datasetId: sourceDatasetId, path: sourcePath })
    }

    state.sourcePaths = sourcePaths
    state.initialized = true

    return { sourcePaths, outputPath: getDatasetOutputPath(datasetId) }
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

function createTransformDatasetContextDefinition<Env extends { orgId: string }>(
    params: TransformDatasetAgentParams,
): { datasetId: string; context: any } {
    const datasetId = params.datasetId ?? id()
    const model = params.model ?? "openai/gpt-5"

    let contextBuilder = createContext<Env>("dataset.transform")
        .context(async (stored: any, _env: Env, runtime: any) => {
            const previous = (stored?.content as any) ?? {}
            const sandboxState: TransformSandboxState = previous?.sandboxState ?? { initialized: false, sourcePaths: [] }
            const sandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""
            if (!sandboxId) {
                throw new Error("dataset_sandbox_required")
            }

        const { sourcePaths, outputPath } = await ensureSourcesInSandbox(
                runtime,
                sandboxId,
            datasetId,
                params.sourceDatasetIds,
                sandboxState,
        )

        const sourcePreviews: Array<{ datasetId: string; preview: TransformSourcePreviewContext }> = []
            for (const sp of sourcePaths) {
            try {
                    const preview = await generateSourcePreview(runtime, sandboxId, sp.path, datasetId)
                    sourcePreviews.push({ datasetId: sp.datasetId, preview })
            } catch {
                // optional
            }
        }

            // Persist output schema on the dataset record (so completeDataset validates against it)
            await datasetUpdateSchemaStep({
                runtime,
                datasetId,
                schema: params.outputSchema,
                status: "schema_complete",
            })

            const promptContext: TransformPromptContext = {
            datasetId,
                sourceDatasetIds: params.sourceDatasetIds,
                outputSchema: params.outputSchema,
            sandboxConfig: { sourcePaths, outputPath },
            sourcePreviews: sourcePreviews.length > 0 ? sourcePreviews : undefined,
            errors: [],
            }

            const basePrompt = buildTransformDatasetPrompt(promptContext)
            const userInstructions = String(params.instructions ?? "").trim()
            const system = userInstructions
                ? [
                    "## USER INSTRUCTIONS",
                    "The following instructions were provided by the user. Apply them in addition to (and with higher priority than) the default instructions.",
                    "",
                    userInstructions,
                    "",
                    basePrompt,
                ].join("\n")
                : basePrompt

            return {
                ...previous,
                datasetId,
                sandboxId,
                sandboxState,
                system,
                sandboxConfig: { sourcePaths, outputPath },
            }
        })
        .narrative(async (stored: any) => {
            return String(stored?.content?.system ?? "")
        })
        .actions(async (stored: any, _env: Env, runtime: any) => {
            const sandboxId = (stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
            return {
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
                } as any
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

    return { datasetId, context }
}

export function createTransformDatasetContext<Env extends { orgId: string }>(
    params: {
        sourceDatasetIds: string[]
        outputSchema: any
        instructions?: string
        datasetId?: string
        model?: string
        sandboxId?: string
        reactor?: ContextReactor<any, any>
    },
) {
    const { datasetId, context } = createTransformDatasetContextDefinition<Env>({
        sourceDatasetIds: params.sourceDatasetIds,
        outputSchema: params.outputSchema,
        instructions: params.instructions,
        datasetId: params.datasetId,
        model: params.model,
        sandboxId: params.sandboxId,
        reactor: params.reactor,
    })

    return {
        datasetId,
        async transform(runtime: { env: Env }, options: TransformDatasetRunOptions = {}): Promise<{ datasetId: string }> {
            const datasetCountText =
                params.sourceDatasetIds.length === 1
                    ? "the source dataset"
                    : `${params.sourceDatasetIds.length} source datasets`

        const triggerEvent = {
            id: id(),
            type: INPUT_TEXT_ITEM_TYPE,
            channel: WEB_CHANNEL,
            createdAt: new Date().toISOString(),
            content: {
                    parts: [
                        {
                            type: "text",
                            text:
                                options.prompt ??
                                `Transform ${datasetCountText} into a new dataset matching the provided output schema`,
                        },
                    ],
            },
        } as any

        const shell = await context.react(triggerEvent, {
                runtime: runtime as any,
                context: { key: `dataset:${datasetId}` },
                durable: options.durable ?? false,
            options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 20, maxModelSteps: 5 },
        })
        await awaitContextRun(shell.run)

            return { datasetId }
        },
        context,
    }
}


