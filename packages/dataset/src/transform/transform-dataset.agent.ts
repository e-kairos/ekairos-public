import {
  createContext,
  INPUT_TEXT_ITEM_TYPE,
  WEB_CHANNEL,
  type ContextReactor,
} from "@ekairos/events"
import { id } from "@instantdb/admin"

import { createClearDatasetTool } from "../clearDataset.tool.js"
import {
  createCompleteDatasetTool,
  didCompleteDatasetSucceed,
} from "../completeDataset.tool.js"
import { datasetUpdateSchemaStep } from "../dataset/steps.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import {
  buildTransformDatasetPromptStep,
  ensureTransformSourcesInSandboxStep,
  generateTransformSourcePreviewsStep,
} from "./transform-dataset.steps.js"
import type {
  TransformDatasetAgentParams,
  TransformDatasetContext,
  TransformDatasetResult,
  TransformDatasetRunOptions,
  TransformPromptContext,
  TransformSandboxState,
} from "./transform-dataset.types.js"

export type {
  TransformDatasetAgentParams,
  TransformDatasetContext,
  TransformDatasetResult,
  TransformDatasetRunOptions,
  TransformPromptContext,
  TransformSandboxState,
} from "./transform-dataset.types.js"

async function awaitContextRun(run: any) {
  if (!run) return
  if (run.returnValue) {
    await run.returnValue
    return
  }
  await run
}

function createTransformDatasetContextDefinition<Env extends { orgId: string }>(
  params: TransformDatasetAgentParams,
): { datasetId: string; context: any } {
  const fallbackDatasetId = params.datasetId
  const model = params.model ?? "openai/gpt-5"

  let contextBuilder = createContext<Env>("dataset.transform")
    .context(async (stored: any, _env: Env, runtime: any) => {
      const previous = (stored?.content as any) ?? {}
      const sandboxState: TransformSandboxState =
        previous?.sandboxState ?? { initialized: false, sourcePaths: [] }
      const datasetId: string = previous?.datasetId ?? fallbackDatasetId ?? ""
      const sourceDatasetIds: string[] = Array.isArray(previous?.sourceDatasetIds)
        ? previous.sourceDatasetIds
        : Array.isArray(params.sourceDatasetIds)
          ? params.sourceDatasetIds
          : []
      const outputSchema = previous?.outputSchema ?? params.outputSchema
      const instructions = previous?.instructions ?? params.instructions
      const sandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""
      if (!datasetId) {
        throw new Error("dataset_id_required")
      }
      if (sourceDatasetIds.length === 0) {
        throw new Error("dataset_transform_sources_required")
      }
      if (!outputSchema) {
        throw new Error("dataset_transform_schema_required")
      }
      if (!sandboxId) {
        throw new Error("dataset_sandbox_required")
      }

      const initialized = await ensureTransformSourcesInSandboxStep({
        runtime,
        sandboxId,
        datasetId,
        sourceDatasetIds,
        state: sandboxState,
      })

      const sourcePreviews = await generateTransformSourcePreviewsStep({
        runtime,
        sandboxId,
        datasetId,
        sourcePaths: initialized.sourcePaths,
      })

      await datasetUpdateSchemaStep({
        runtime,
        datasetId,
        schema: outputSchema,
        status: "schema_complete",
      })

      const promptContext: TransformPromptContext = {
        datasetId,
        sourceDatasetIds,
        outputSchema,
        sandboxConfig: {
          sourcePaths: initialized.sourcePaths,
          outputPath: initialized.outputPath,
        },
        sourcePreviews: sourcePreviews.length > 0 ? sourcePreviews : undefined,
        errors: [],
      }

      const basePrompt = await buildTransformDatasetPromptStep({
        context: promptContext,
      })
      const userInstructions = String(instructions ?? "").trim()
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
        sourceDatasetIds,
        outputSchema,
        instructions,
        sandboxId,
        sandboxState: initialized.state,
        system,
        sandboxConfig: {
          sourcePaths: initialized.sourcePaths,
          outputPath: initialized.outputPath,
        },
      }
    })
    .narrative(async (stored: any) => {
      return String(stored?.content?.system ?? "")
    })
    .actions(async (stored: any, _env: Env, runtime: any) => {
      const datasetId: string = stored?.content?.datasetId ?? fallbackDatasetId ?? ""
      const sandboxId = (stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
      if (!datasetId) throw new Error("dataset_id_required")
      if (!sandboxId) throw new Error("dataset_sandbox_required")
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

  return { datasetId: fallbackDatasetId ?? "", context }
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
  const datasetId = params.datasetId ?? id()
  const { context } = createTransformDatasetContextDefinition<Env>({
    sourceDatasetIds: params.sourceDatasetIds,
    outputSchema: params.outputSchema,
    instructions: params.instructions,
    datasetId,
    model: params.model,
    sandboxId: params.sandboxId,
    reactor: params.reactor,
  })

  return {
    datasetId,
    async transform(
      runtime: { env: Env },
      options: TransformDatasetRunOptions = {},
    ): Promise<{ datasetId: string }> {
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
        options: {
          silent: true,
          preventClose: true,
          sendFinish: false,
          maxIterations: 20,
          maxModelSteps: 5,
        },
        __initialContent: {
          datasetId,
          sourceDatasetIds: params.sourceDatasetIds,
          outputSchema: params.outputSchema,
          instructions: params.instructions,
          sandboxId: params.sandboxId ?? "",
          sandboxState: { initialized: false, sourcePaths: [] },
        },
      })
      await awaitContextRun(shell.run)

      return { datasetId }
    },
    context,
  }
}

export function registerTransformDatasetContext<Env extends { orgId: string }>(
  opts?: {
    model?: string
    reactor?: ContextReactor<any, any>
  },
) {
  createTransformDatasetContextDefinition<Env>({
    model: opts?.model,
    reactor: opts?.reactor,
  }).context
}

registerTransformDatasetContext()
