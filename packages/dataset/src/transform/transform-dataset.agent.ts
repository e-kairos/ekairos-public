import { createThread, didToolExecute, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL } from "@ekairos/thread"
import { createCompleteDatasetTool } from "../completeDataset.tool"
import { createExecuteCommandTool } from "../executeCommand.tool"
import { createClearDatasetTool } from "../clearDataset.tool"
import { buildTransformDatasetPrompt, TransformPromptContext } from "./prompts"
import { getDatasetWorkstation, getDatasetOutputPath } from "../datasetFiles"
import { id } from "@instantdb/admin"
import { generateSourcePreview, TransformSourcePreviewContext } from "./filepreview"
import { datasetReadOutputJsonlStep, datasetUpdateSchemaStep } from "../dataset/steps"
import { createDatasetSandboxStep, runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps"

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
}

// Sandbox initialization state (closure-based)
type TransformSandboxState = {
    initialized: boolean
    sourcePaths: Array<{ datasetId: string; path: string }>
}

async function ensureSourcesInSandbox(
    env: any,
    sandboxId: string,
    datasetId: string,
    sourceDatasetIds: string[],
    state: TransformSandboxState
): Promise<{ sourcePaths: Array<{ datasetId: string; path: string }>; outputPath: string }> {
    if (state.initialized) {
        return { sourcePaths: state.sourcePaths, outputPath: getDatasetOutputPath(datasetId) }
    }

    const workstation = getDatasetWorkstation(datasetId)

    await runDatasetSandboxCommandStep({ env, sandboxId, cmd: "mkdir", args: ["-p", workstation] })

    const sourcePaths: Array<{ datasetId: string; path: string }> = []

    for (const sourceDatasetId of sourceDatasetIds) {
        const sourcePath = `${workstation}/source_${sourceDatasetId}.jsonl`

        const source = await datasetReadOutputJsonlStep({ env, datasetId: sourceDatasetId })
        await writeDatasetSandboxFilesStep({
            env,
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

function createTransformDatasetStoryDefinition<Env extends { orgId: string }>(
    params: TransformDatasetAgentParams,
): { datasetId: string; story: any } {
    const datasetId = params.datasetId ?? id()
    const model = params.model ?? "openai/gpt-5"

    const story = createThread<Env>("dataset.transform")
        .context(async (stored: any, env: Env) => {
            const previous = (stored?.content as any) ?? {}
            const sandboxState: TransformSandboxState = previous?.sandboxState ?? { initialized: false, sourcePaths: [] }
            const existingSandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""

            let sandboxId = existingSandboxId
            if (!sandboxId) {
                const created = await createDatasetSandboxStep({ env, runtime: "python3.13", timeoutMs: 10 * 60 * 1000 })
                sandboxId = created.sandboxId
            }

        const { sourcePaths, outputPath } = await ensureSourcesInSandbox(
                env,
                sandboxId,
            datasetId,
                params.sourceDatasetIds,
                sandboxState,
        )

        const sourcePreviews: Array<{ datasetId: string; preview: TransformSourcePreviewContext }> = []
            for (const sp of sourcePaths) {
            try {
                    const preview = await generateSourcePreview(env, sandboxId, sp.path, datasetId)
                    sourcePreviews.push({ datasetId: sp.datasetId, preview })
            } catch {
                // optional
            }
        }

            // Persist output schema on the dataset record (so completeDataset validates against it)
            await datasetUpdateSchemaStep({
                env,
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
        .actions(async (stored: any, env: Env) => {
            const sandboxId = (stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
            return {
            executeCommand: createExecuteCommandTool({
                    datasetId,
                    sandboxId,
                    env,
            }),
            completeDataset: createCompleteDatasetTool({
                    datasetId,
                    sandboxId,
                    env,
            }),
            clearDataset: createClearDatasetTool({
                    datasetId,
                    sandboxId,
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

export function createTransformDatasetStory<Env extends { orgId: string }>(
    params: {
        sourceDatasetIds: string[]
        outputSchema: any
        instructions?: string
        datasetId?: string
        model?: string
        sandboxId?: string
    },
) {
    const { datasetId, story } = createTransformDatasetStoryDefinition<Env>({
        sourceDatasetIds: params.sourceDatasetIds,
        outputSchema: params.outputSchema,
        instructions: params.instructions,
        datasetId: params.datasetId,
        model: params.model,
        sandboxId: params.sandboxId,
    })

    return {
        datasetId,
        async transform(env: Env, prompt?: string): Promise<{ datasetId: string }> {
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
                                prompt ??
                                `Transform ${datasetCountText} into a new dataset matching the provided output schema`,
                        },
                    ],
            },
        } as any

        await story.react(triggerEvent, {
                env,
                context: { key: `dataset:${datasetId}` },
            options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 20, maxModelSteps: 5 },
        })

            return { datasetId }
        },
        story,
    }
}


