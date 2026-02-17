import { getThreadEnv } from "@ekairos/thread/runtime"
import { datasetPreviewRowsStep } from "../dataset/steps"
import { createTransformDatasetStory } from "./transform-dataset.agent"

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
 * Executes the transform story and returns datasetId + preview rows.
 */
export async function transformDataset(
  input: TransformDatasetInput,
): Promise<TransformDatasetResult> {
  const env = await getThreadEnv()
  const { datasetId, story } = createTransformDatasetStory({
    sourceDatasetIds: input.datasets.map((d) => d.id),
    outputSchema: input.outputSchema,
    instructions: buildInstructions(input),
    datasetId: input.datasetId,
    model: input.model,
  })

  await story.transform(env as any)

  const preview = await datasetPreviewRowsStep({ datasetId })
  return { datasetId, previewRows: preview.rows }
}
