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
import { datasetGetByIdStep } from "../dataset/steps.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import { createGenerateSchemaTool } from "./generateSchema.tool.js"
import {
  buildFileDatasetPromptStep,
  generateFileParsePreviewStep,
  initializeFileParseSandboxStep,
} from "./file-dataset.steps.js"
import type {
  DatasetResult,
  FileParseContext,
  FileParseContextBuilder,
  FileParseContextParams,
  FileParseRunOptions,
  SandboxState,
} from "./file-dataset.types.js"

export type {
  DatasetResult,
  FileParseContext,
  FileParseContextBuilder,
  FileParseContextParams,
  FileParseRunOptions,
  SandboxState,
} from "./file-dataset.types.js"

async function awaitContextRun(run: any) {
  if (!run) return
  if (run.returnValue) {
    await run.returnValue
    return
  }
  await run
}

function createFileParseContextDefinition<Env extends { orgId: string }>(
  params: FileParseContextParams,
): { datasetId: string; context: any } {
  const fallbackDatasetId = params.datasetId
  const model = params.model ?? "openai/gpt-5"

  let contextBuilder = createContext<Env>("file.parse")
    .context(async (stored: any, _env: Env, runtime: any) => {
      const previous = (stored?.content as any) ?? {}
      const sandboxState: SandboxState =
        previous?.sandboxState ?? { initialized: false, filePath: "" }
      const datasetId: string = previous?.datasetId ?? fallbackDatasetId ?? ""
      const fileId: string = previous?.fileId ?? params.fileId ?? ""
      const instructions: string =
        previous?.instructions ?? params.instructions ?? ""
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

      const initialized = await initializeFileParseSandboxStep({
        runtime,
        sandboxId,
        datasetId,
        fileId,
        state: sandboxState,
      })
      const sandboxFilePath = initialized.filePath

      let filePreview: FileParseContext["filePreview"] = undefined
      try {
        filePreview = await generateFileParsePreviewStep({
          runtime,
          sandboxId,
          sandboxFilePath,
          datasetId,
        })
      } catch {
        // Preview is optional; parsing can still proceed from the file path.
      }

      let schema: any | null = null
      const datasetResult = await datasetGetByIdStep({ runtime, datasetId })
      if (datasetResult.ok && datasetResult.data.schema) {
        schema = datasetResult.data.schema
      }

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
        sandboxState: initialized.state,
        ctx,
      }
    })
    .narrative(async (stored: any) => {
      const ctx: FileParseContext = stored?.content?.ctx
      const base = await buildFileDatasetPromptStep({ context: ctx })
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
      const sandboxId: string =
        (_stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
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
    async parse(
      runtime: { env: Env },
      options: FileParseRunOptions = {},
    ): Promise<{ datasetId: string }> {
      const triggerEvent = {
        id: id(),
        type: INPUT_TEXT_ITEM_TYPE,
        channel: WEB_CHANNEL,
        createdAt: new Date().toISOString(),
        content: {
          parts: [
            {
              type: "text",
              text: options.prompt ?? "generate a dataset for this file",
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
          fileId,
          instructions: opts?.instructions ?? "",
          sandboxId: opts?.sandboxId ?? "",
          sandboxState: { initialized: false, filePath: "" },
        },
      })
      await awaitContextRun(shell.run)

      return { datasetId }
    },
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
