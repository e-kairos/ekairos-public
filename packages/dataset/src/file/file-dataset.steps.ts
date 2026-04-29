import { getDatasetWorkstation } from "../datasetFiles.js"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import { buildFileDatasetPrompt } from "./prompts.js"
import { generateFilePreview, ensurePreviewScriptsAvailable } from "./filepreview.js"
import { readInstantFileStep } from "./steps.js"
import type { FileParseContext, SandboxState } from "./file-dataset.types.js"
import type { FilePreviewContext } from "./filepreview.types.js"

export async function initializeFileParseSandboxStep(params: {
  runtime: any
  sandboxId: string
  datasetId: string
  fileId: string
  state: SandboxState
}): Promise<{ filePath: string; state: SandboxState }> {
  "use step"

  if (params.state.initialized) {
    return { filePath: params.state.filePath, state: params.state }
  }

  console.log(`[FileParseContext ${params.datasetId}] Initializing sandbox...`)

  await ensurePreviewScriptsAvailable(params.runtime, params.sandboxId)

  console.log(`[FileParseContext ${params.datasetId}] Installing Python dependencies...`)

  const pipInstall = await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "python",
    args: ["-m", "pip", "install", "pandas", "openpyxl", "--quiet", "--upgrade"],
  })
  const installStderr = pipInstall.stderr

  if (installStderr && (installStderr.includes("ERROR") || installStderr.includes("FAILED"))) {
    throw new Error(`pip install failed: ${installStderr.substring(0, 300)}`)
  }

  console.log(`[FileParseContext ${params.datasetId}] Fetching file from InstantDB...`)
  const file = await readInstantFileStep({ runtime: params.runtime, fileId: params.fileId })

  console.log(`[FileParseContext ${params.datasetId}] Creating dataset workstation...`)

  const workstation = getDatasetWorkstation(params.datasetId)
  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", workstation],
  })

  const fileName = file.contentDisposition ?? ""
  const fileExtension = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ""
  const sandboxFilePath = `${workstation}/${params.fileId}${fileExtension}`

  await writeDatasetSandboxFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [
      {
        path: sandboxFilePath,
        contentBase64: file.contentBase64,
      },
    ],
  })

  console.log(`[FileParseContext ${params.datasetId}] Workstation created: ${workstation}`)
  console.log(`[FileParseContext ${params.datasetId}] File saved: ${sandboxFilePath}`)

  const state = {
    initialized: true,
    filePath: sandboxFilePath,
  }

  return { filePath: sandboxFilePath, state }
}

export async function generateFileParsePreviewStep(params: {
  runtime: any
  sandboxId: string
  sandboxFilePath: string
  datasetId: string
}): Promise<FilePreviewContext> {
  "use step"

  return await generateFilePreview(
    params.runtime,
    params.sandboxId,
    params.sandboxFilePath,
    params.datasetId,
  )
}

export async function buildFileDatasetPromptStep(params: {
  context: FileParseContext
}): Promise<string> {
  "use step"

  return buildFileDatasetPrompt(params.context)
}
