import { getDatasetOutputPath, getDatasetWorkstation } from "../datasetFiles.js"
import { datasetReadOutputJsonlStep } from "../dataset/steps.js"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import { generateSourcePreview } from "./filepreview.js"
import { buildTransformDatasetPrompt } from "./prompts.js"
import type {
  TransformPromptContext,
  TransformSandboxState,
  TransformSourcePreviewContext,
} from "./transform-dataset.types.js"

export async function ensureTransformSourcesInSandboxStep(params: {
  runtime: any
  sandboxId: string
  datasetId: string
  sourceDatasetIds: string[]
  state: TransformSandboxState
}): Promise<{
  sourcePaths: Array<{ datasetId: string; path: string }>
  outputPath: string
  state: TransformSandboxState
}> {
  "use step"

  if (params.state.initialized) {
    return {
      sourcePaths: params.state.sourcePaths,
      outputPath: getDatasetOutputPath(params.datasetId),
      state: params.state,
    }
  }

  const workstation = getDatasetWorkstation(params.datasetId)

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", workstation],
  })

  const sourcePaths: Array<{ datasetId: string; path: string }> = []

  for (const sourceDatasetId of params.sourceDatasetIds) {
    const sourcePath = `${workstation}/source_${sourceDatasetId}.jsonl`

    const source = await datasetReadOutputJsonlStep({
      runtime: params.runtime,
      datasetId: sourceDatasetId,
    })
    await writeDatasetSandboxFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [{ path: sourcePath, contentBase64: source.contentBase64 }],
    })

    sourcePaths.push({ datasetId: sourceDatasetId, path: sourcePath })
  }

  return {
    sourcePaths,
    outputPath: getDatasetOutputPath(params.datasetId),
    state: {
      initialized: true,
      sourcePaths,
    },
  }
}

export async function generateTransformSourcePreviewsStep(params: {
  runtime: any
  sandboxId: string
  datasetId: string
  sourcePaths: Array<{ datasetId: string; path: string }>
}): Promise<Array<{ datasetId: string; preview: TransformSourcePreviewContext }>> {
  "use step"

  const sourcePreviews: Array<{ datasetId: string; preview: TransformSourcePreviewContext }> = []
  for (const sourcePath of params.sourcePaths) {
    try {
      const preview = await generateSourcePreview(
        params.runtime,
        params.sandboxId,
        sourcePath.path,
        params.datasetId,
      )
      sourcePreviews.push({ datasetId: sourcePath.datasetId, preview })
    } catch {
      // Source preview is optional; transformation can still read the JSONL files.
    }
  }
  return sourcePreviews
}

export async function buildTransformDatasetPromptStep(params: {
  context: TransformPromptContext
}): Promise<string> {
  "use step"

  return buildTransformDatasetPrompt(params.context)
}
