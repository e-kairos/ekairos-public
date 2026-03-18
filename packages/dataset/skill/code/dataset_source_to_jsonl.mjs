import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { instantQuery, readJsonFile } from "./_runtime.mjs"

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("dataset_source_input_path_required")
  process.exit(1)
}

const input = await readJsonFile(inputPath)
const datasetId = String(input.datasetId ?? "").trim()
const outputPath = String(input.outputPath ?? "").trim()

if (!datasetId) {
  console.error("dataset_source_dataset_id_required")
  process.exit(1)
}
if (!outputPath) {
  console.error("dataset_source_output_path_required")
  process.exit(1)
}

const result = await instantQuery(
  {
    dataset_datasets: {
      $: { where: { datasetId }, limit: 1 },
      dataFile: {},
    },
  },
  input.manifestPath,
)

const row = Array.isArray(result?.dataset_datasets) ? result.dataset_datasets[0] : null
const linkedFile = Array.isArray(row?.dataFile) ? row.dataFile[0] : row?.dataFile
const url = String(linkedFile?.url ?? "").trim()
if (!url) {
  console.error("dataset_source_file_url_missing")
  process.exit(1)
}

const response = await fetch(url)
if (!response.ok) {
  console.error(`dataset_source_download_failed:${response.status}`)
  process.exit(1)
}

const text = await response.text()
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, text, "utf8")
process.stdout.write(JSON.stringify({ outputPath, bytes: text.length }))
