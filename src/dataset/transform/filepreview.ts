import { Sandbox } from "@vercel/sandbox"
import { getDatasetWorkstation } from "../datasetFiles"

export type TransformSourcePreviewContext = {
    totalRows: number
    metadata?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
    }
    head?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
    }
}

interface PreviewOptions {
    headLines?: number
}

const DEFAULT_HEAD_LINES = 50

async function runPythonSnippet(
    sandbox: Sandbox,
    datasetId: string,
    scriptName: string,
    code: string,
    args: string[],
    description: string
): Promise<{
    description: string
    script: string
    command: string
    stdout: string
    stderr: string
}> {
    const workstation = getDatasetWorkstation(datasetId)
    const scriptPath = `${workstation}/${scriptName}.py`

    await sandbox.writeFiles([
        {
            path: scriptPath,
            content: Buffer.from(code, "utf-8"),
        },
    ])

    const result = await sandbox.runCommand({
        cmd: "python",
        args: [scriptPath, ...args],
    })

    const stdout = (await result.stdout()) || ""
    const stderr = (await result.stderr()) || ""

    return {
        description,
        script: code,
        command: `python ${scriptPath} ${args.join(" ")}`,
        stdout,
        stderr,
    }
}

export async function generateSourcePreview(
    sandbox: Sandbox,
    sourcePath: string,
    datasetId: string,
    options: PreviewOptions = {}
): Promise<TransformSourcePreviewContext> {
    const context: TransformSourcePreviewContext = {
        totalRows: 0,
    }

    const countScript = `
import json, sys
path = sys.argv[1]
count = 0
try:
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                obj = json.loads(s)
                if isinstance(obj, dict) and obj.get('type') == 'row' and 'data' in obj:
                    count += 1
            except Exception:
                pass
    print(json.dumps({ 'row_count': count }))
except Exception as e:
    print(str(e))
`

    const meta = await runPythonSnippet(
        sandbox,
        datasetId,
        "jsonl_count",
        countScript,
        [sourcePath],
        "Counts number of JSONL records with type='row'"
    )
    context.metadata = meta
    try {
        if (meta.stdout) {
            const parsed = JSON.parse(meta.stdout)
            context.totalRows = Number(parsed.row_count || 0)
        }
    }
    catch {
        context.totalRows = 0
    }

    const headLines = options.headLines || DEFAULT_HEAD_LINES

    const headScript = `
import json, sys
path = sys.argv[1]
limit = int(sys.argv[2])
printed = 0
try:
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            if printed >= limit:
                break
            s = line.strip()
            if not s:
                continue
            try:
                obj = json.loads(s)
                if isinstance(obj, dict) and obj.get('type') == 'row' and 'data' in obj:
                    print(json.dumps(obj))
                    printed += 1
            except Exception:
                pass
except Exception as e:
    print(str(e))
`

    const head = await runPythonSnippet(
        sandbox,
        datasetId,
        "jsonl_head",
        headScript,
        [sourcePath, String(headLines)],
        `Reads the first ${headLines} JSONL row records`
    )
    context.head = head

    return context
}


