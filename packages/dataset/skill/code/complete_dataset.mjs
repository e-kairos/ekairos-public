import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  countJsonlRows,
  instantQuery,
  instantTransact,
  instantUploadFile,
  newId,
  readJsonFile,
} from "./_runtime.mjs"

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("complete_dataset_input_path_required")
  process.exit(1)
}

const input = await readJsonFile(inputPath)
const datasetId = String(input.datasetId ?? "").trim()
const outputPath = String(input.outputPath ?? "").trim()

if (!datasetId) {
  console.error("complete_dataset_dataset_id_required")
  process.exit(1)
}
if (!outputPath) {
  console.error("complete_dataset_output_path_required")
  process.exit(1)
}

const fileBuffer = await readFile(outputPath)
const fileName = path.basename(outputPath) || "output.jsonl"
const storagePath = `/dataset/${datasetId}/${fileName}`
const uploaded = await instantUploadFile({
  path: storagePath,
  buffer: fileBuffer,
  contentType: "application/x-ndjson",
  contentDisposition: fileName,
  manifestPath: input.manifestPath,
})

const uploadedFileId = String(uploaded?.data?.id ?? uploaded?.id ?? "").trim()
if (!uploadedFileId) {
  console.error("complete_dataset_uploaded_file_id_missing")
  process.exit(1)
}

const existing = await instantQuery(
  {
    dataset_datasets: {
      $: { where: { datasetId }, limit: 1 },
    },
  },
  input.manifestPath,
)

const current = Array.isArray(existing?.dataset_datasets) ? existing.dataset_datasets[0] : null
const entityId = String(current?.id ?? newId())
const rowCount = countJsonlRows(fileBuffer.toString("utf8"))
const createdAt = Number(current?.createdAt ?? Date.now())

const steps = [
  [
    "update",
    "dataset_datasets",
    entityId,
    {
      datasetId,
      sandboxId: input.sandboxId ?? current?.sandboxId ?? null,
      title: input.title ?? current?.title ?? datasetId,
      status: "completed",
      organizationId: input.organizationId ?? current?.organizationId ?? null,
      instructions: input.instructions ?? current?.instructions ?? "",
      sources: input.sources ?? current?.sources ?? [],
      sourceKinds: input.sourceKinds ?? current?.sourceKinds ?? [],
      analysis: input.analysis ?? current?.analysis ?? null,
      schema: input.schema ?? current?.schema ?? null,
      calculatedTotalRows: rowCount,
      actualGeneratedRowCount: rowCount,
      createdAt,
      updatedAt: Date.now(),
    },
  ],
  [
    "link",
    "dataset_datasets",
    entityId,
    {
      dataFile: uploadedFileId,
    },
  ],
]

const result = await instantTransact(steps, input.manifestPath)
process.stdout.write(
  JSON.stringify({
    datasetId,
    entityId,
    uploadedFileId,
    rowCount,
    storagePath,
    result,
  }),
)
