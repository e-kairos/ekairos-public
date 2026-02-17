import { getDatasetOutputPath, getDatasetWorkstation } from "./datasetFiles.js"
import { createDatasetSandboxStep, runDatasetSandboxCommandStep } from "./sandbox/steps.js"
import { getThreadRuntime } from "./runtime.js"

export type StructureRowsOutputPagingCursor = {
  byteOffset: number
  rowOffset: number
}

export type StructureRowsOutputSandboxRef = {
  sandboxId: string
  localPath: string
}

/**
 * Step 1/2:
 * Download the rows output.jsonl from Instant storage into a sandbox file.
 *
 * This isolates network flakiness (e.g. undici `TypeError: terminated`) into a single step
 * and makes subsequent reads purely sandbox-local.
 */
export async function structureDownloadRowsOutputToSandboxStep(params: {
  env: any
  structureId: string
  sandboxId?: string
  runtime?: string
  timeoutMs?: number
}): Promise<StructureRowsOutputSandboxRef> {
  "use step"

  const runtime = params.runtime ?? "python3.13"
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000

  const sandboxId =
    params.sandboxId ??
    (
      await createDatasetSandboxStep({
        env: params.env,
        runtime,
        timeoutMs,
        purpose: "structure.rows-output.reader",
        params: { structureId: params.structureId },
      })
    ).sandboxId

  const workstation = getDatasetWorkstation(params.structureId)
  const localPath = getDatasetOutputPath(params.structureId)

  await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId,
    cmd: "mkdir",
    args: ["-p", workstation],
  })

  const exists = await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId,
    cmd: "test",
    args: ["-f", localPath],
  })
  if (exists.exitCode === 0) {
    return { sandboxId, localPath }
  }

  const storyRuntime = await getThreadRuntime(params.env)
  const db = storyRuntime.db

  const contextKey = `structure:${params.structureId}`
  const query = (await db.query({
    thread_contexts: {
      $: { where: { key: contextKey }, limit: 1 },
      structure_output_file: {},
    },
  })) as any
  const ctx = query.thread_contexts?.[0]
  const linked = Array.isArray(ctx?.structure_output_file) ? ctx.structure_output_file[0] : ctx.structure_output_file
  const url = linked?.url
  if (!url) {
    throw new Error("Rows output file not found")
  }

  // Download inside the sandbox runtime (python) to avoid streaming aborts in the Node step runtime.
  const py = [
    "import sys, urllib.request",
    "url = sys.argv[1]",
    "out_path = sys.argv[2]",
    "with urllib.request.urlopen(url) as r:",
    "  data = r.read()",
    "with open(out_path, 'wb') as f:",
    "  f.write(data)",
    "print('ok', len(data))",
  ].join("\n")

  const res = await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId,
    cmd: "python",
    args: ["-c", py, String(url), localPath],
  })
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || "Failed to download rows output to sandbox")
  }

  return { sandboxId, localPath }
}

export type StructureReadRowsOutputPageFromSandboxResult = {
  rows: any[]
  nextCursor: StructureRowsOutputPagingCursor
  done: boolean
}

/**
 * Step 2/2:
 * Read the next page of ROW records from the sandbox-local output.jsonl, bounded by `limit`.
 *
 * Pagination state is passed explicitly via `cursor` and returned as `nextCursor`.
 */
export async function structureReadRowsOutputPageFromSandboxStep(params: {
  env: any
  sandboxId: string
  localPath: string
  cursor?: Partial<StructureRowsOutputPagingCursor>
  limit: number
}): Promise<StructureReadRowsOutputPageFromSandboxResult> {
  "use step"

  const byteOffset = params.cursor?.byteOffset ?? 0
  const rowOffset = params.cursor?.rowOffset ?? 0

  const py = [
    "import sys, json",
    "path = sys.argv[1]",
    "byte_offset = int(sys.argv[2])",
    "row_offset = int(sys.argv[3])",
    "limit = int(sys.argv[4])",
    "rows = []",
    "next_byte = byte_offset",
    "next_row = row_offset",
    "with open(path, 'rb') as f:",
    "  f.seek(byte_offset)",
    "  while len(rows) < limit:",
    "    line = f.readline()",
    "    if not line:",
    "      break",
    "    next_byte = f.tell()",
    "    try:",
    "      obj = json.loads(line.decode('utf-8'))",
    "    except Exception:",
    "      continue",
    "    if obj.get('type') != 'row':",
    "      continue",
    "    rows.append(obj.get('data'))",
    "    next_row += 1",
    "done = len(rows) < limit",
    "print(json.dumps({",
    "  'rows': rows,",
    "  'nextByteOffset': next_byte,",
    "  'nextRowOffset': next_row,",
    "  'done': done,",
    "}))",
  ].join("\n")

  const res = await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId: params.sandboxId,
    cmd: "python",
    args: ["-c", py, params.localPath, String(byteOffset), String(rowOffset), String(params.limit)],
  })
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || "Failed to read rows page from sandbox")
  }

  const out = String(res.stdout ?? "").trim()
  const parsed = JSON.parse(out) as any

  return {
    rows: parsed.rows ?? [],
    nextCursor: {
      byteOffset: parsed.nextByteOffset ?? byteOffset,
      rowOffset: parsed.nextRowOffset ?? rowOffset,
    },
    done: Boolean(parsed.done),
  }
}

/**
 * Back-compat alias (older naming).
 * Prefer `structureReadRowsOutputPageFromSandboxStep`.
 */
export async function structureReadRowsOutputChunkStep(params: {
  env: any
  sandboxId: string
  localPath: string
  byteOffset?: number
  rowOffset?: number
  limit: number
}) {
  const res = await structureReadRowsOutputPageFromSandboxStep({
    env: params.env,
    sandboxId: params.sandboxId,
    localPath: params.localPath,
    cursor: { byteOffset: params.byteOffset ?? 0, rowOffset: params.rowOffset ?? 0 },
    limit: params.limit,
  })

  return {
    rows: res.rows,
    nextByteOffset: res.nextCursor.byteOffset,
    nextRowOffset: res.nextCursor.rowOffset,
    done: res.done,
  }
}


