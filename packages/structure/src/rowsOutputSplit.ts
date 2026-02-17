import { getDatasetOutputPath, getDatasetWorkstation } from "./datasetFiles.js"
import { readDatasetSandboxFileStep, runDatasetSandboxCommandStep } from "./sandbox/steps.js"
import type { StructureRowsOutputPagingCursor } from "./rowsOutputPaging.js"
import { getThreadRuntime } from "./runtime.js"

export type StructureSplitRowsOutputToDatasetResult = {
  datasetId?: string
  rowsWritten: number
  nextCursor: StructureRowsOutputPagingCursor
  done: boolean
}

/**
 * Step:
 * Split a sandbox-local `output.jsonl` into a child dataset (also `output.jsonl`) of up to `limit` ROW entries.
 *
 * Key property:
 * - Does NOT return rows; it persists a child dataset and returns only `{ datasetId, nextCursor, done }`.
 *
 * This is useful for workflows where you want to batch work (e.g. 300 rows) without moving large payloads
 * through workflow/step params.
 */
export async function structureSplitRowsOutputToDatasetStep(params: {
  env: any
  sandboxId: string
  localPath: string
  cursor?: Partial<StructureRowsOutputPagingCursor>
  limit: number
  childDatasetId: string
}): Promise<StructureSplitRowsOutputToDatasetResult> {
  "use step"

  const byteOffset = params.cursor?.byteOffset ?? 0
  const rowOffset = params.cursor?.rowOffset ?? 0

  const workstation = getDatasetWorkstation(params.childDatasetId)
  const outPath = getDatasetOutputPath(params.childDatasetId)

  await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", workstation],
  })

  // Read from parent jsonl and write a child jsonl containing only ROW records, preserving `{ type, data }` lines.
  const py = [
    "import sys, json",
    "in_path = sys.argv[1]",
    "out_path = sys.argv[2]",
    "byte_offset = int(sys.argv[3])",
    "row_offset = int(sys.argv[4])",
    "limit = int(sys.argv[5])",
    "rows_written = 0",
    "next_byte = byte_offset",
    "next_row = row_offset",
    "with open(in_path, 'rb') as f_in:",
    "  f_in.seek(byte_offset)",
    "  with open(out_path, 'wb') as f_out:",
    "    while rows_written < limit:",
    "      line = f_in.readline()",
    "      if not line:",
    "        break",
    "      next_byte = f_in.tell()",
    "      try:",
    "        obj = json.loads(line.decode('utf-8'))",
    "      except Exception:",
    "        continue",
    "      if obj.get('type') != 'row':",
    "        continue",
    "      f_out.write(line if line.endswith(b'\\n') else (line + b'\\n'))",
    "      rows_written += 1",
    "      next_row += 1",
    "done = rows_written < limit",
    "print(json.dumps({",
    "  'rowsWritten': rows_written,",
    "  'nextByteOffset': next_byte,",
    "  'nextRowOffset': next_row,",
    "  'done': done,",
    "}))",
  ].join("\n")

  const res = await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId: params.sandboxId,
    cmd: "python",
    args: ["-c", py, params.localPath, outPath, String(byteOffset), String(rowOffset), String(params.limit)],
  })

  if (res.exitCode !== 0) {
    throw new Error(res.stderr || "Failed to split rows output to dataset")
  }

  const parsed = JSON.parse(String(res.stdout ?? "").trim()) as any
  const rowsWritten = Number(parsed?.rowsWritten ?? 0)
  const nextCursor: StructureRowsOutputPagingCursor = {
    byteOffset: Number(parsed?.nextByteOffset ?? byteOffset),
    rowOffset: Number(parsed?.nextRowOffset ?? rowOffset),
  }
  const done = Boolean(parsed?.done)

  // No work to persist: return only paging state.
  if (rowsWritten <= 0) {
    return { datasetId: undefined, rowsWritten: 0, nextCursor, done: true }
  }

  const fileRes = await readDatasetSandboxFileStep({
    env: params.env,
    sandboxId: params.sandboxId,
    path: outPath,
  })

  const storyRuntime = await getThreadRuntime(params.env)
  const db = storyRuntime.db
  const store = storyRuntime.store

  const storagePath = `/structure/${params.childDatasetId}/output.jsonl`
  const fileBuffer = Buffer.from(fileRes.contentBase64 ?? "", "base64")
  const uploadResult = await db.storage.uploadFile(storagePath, fileBuffer, {
    contentType: "application/x-ndjson",
    contentDisposition: "output.jsonl",
  })
  const fileId = uploadResult?.data?.id
  if (!fileId) throw new Error("Failed to upload child dataset output file to storage")

  const contextKey = `structure:${params.childDatasetId}`
  const ctx = await store.getOrCreateContext({ key: contextKey })
  const ctxId = ctx?.id
  if (!ctxId) throw new Error("Failed to create child dataset context")

  // Link the output file to the context (used by DatasetService.readRecordsFromFile).
  await db.transact([db.tx.thread_contexts[ctxId].link({ structure_output_file: fileId })])

  // Patch metadata under `structure` namespace (never clobber Story runtime keys).
  const existingContent = (ctx?.content ?? {}) as Record<string, any>
  const existingStructure = (existingContent?.structure ?? {}) as Record<string, any>
  const updatedAt = Date.now()
  await store.updateContextContent(
    { key: contextKey },
    {
      ...existingContent,
      structure: {
        ...existingStructure,
        kind: "ekairos.structure",
        version: Number(existingStructure?.version ?? 1),
        structureId: params.childDatasetId,
        output: "rows",
        updatedAt,
        outputs: {
          ...(existingStructure?.outputs ?? {}),
          rows: {
            format: "jsonl",
            fileId,
            storagePath,
            rowCount: rowsWritten,
          },
        },
      },
    } as any,
  )

  return { datasetId: params.childDatasetId, rowsWritten, nextCursor, done }
}


