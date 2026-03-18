import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { instantQuery, normalizeQueryRows, rowsToJsonl, readJsonFile } from "./_runtime.mjs"

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("query_input_path_required")
  process.exit(1)
}

const input = await readJsonFile(inputPath)
const outputPath = String(input.outputPath ?? "").trim()
if (!outputPath) {
  console.error("query_output_path_required")
  process.exit(1)
}

const result = await instantQuery(input.query ?? {}, input.manifestPath)
const rows = normalizeQueryRows(result)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, rowsToJsonl(rows), "utf8")
process.stdout.write(JSON.stringify({ outputPath, rowCount: rows.length }))
