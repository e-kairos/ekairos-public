import { datasetPreviewRowsStep } from "../dataset/steps.js"
import { createTransformDatasetContext } from "./transform-dataset.agent.js"
import type { AnyDatasetRuntime } from "../builder/types.js"

export type TransformDatasetInput = {
  datasets: Array<{ id: string; description?: string }>
  description: string
  outputSchema: any
  datasetId?: string
  model?: string
}

export type TransformDatasetResult = {
  datasetId: string
  previewRows: any[]
}

function buildInstructions(input: TransformDatasetInput): string {
  const sources = input.datasets
    .map((d, idx) => {
      const name = d.description ? ` - ${d.description}` : ""
      return `${idx + 1}. ${d.id}${name}`
    })
    .join("\n")

  return [
    "Transform datasets into a new dataset.",
    "Use pandas when helpful. Output must be JSONL with {type:'row', data:{...}} lines.",
    "Respect the provided output schema exactly.",
    "",
    "## Source Datasets",
    sources || "- (none)",
    "",
    "## Transformation Description (LaTeX + sets)",
    String(input.description ?? "").trim(),
  ].join("\n")
}

/**
 * Workflow-compatible dataset transform.
 * Executes the transform context and returns datasetId + preview rows.
 */
export async function transformDataset(
  runtime: AnyDatasetRuntime,
  input: TransformDatasetInput,
): Promise<TransformDatasetResult> {
  const transformContext = createTransformDatasetContext({
    sourceDatasetIds: input.datasets.map((d) => d.id),
    outputSchema: input.outputSchema,
    instructions: buildInstructions(input),
    datasetId: input.datasetId,
    model: input.model,
  })

  await transformContext.transform(runtime as any)

  const preview = await datasetPreviewRowsStep({
    runtime,
    datasetId: transformContext.datasetId,
  })
  return { datasetId: transformContext.datasetId, previewRows: preview.rows }
}
