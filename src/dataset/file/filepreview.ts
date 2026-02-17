import { Sandbox } from "@vercel/sandbox"
import { readFileSync } from "fs"
import { join } from "path"

export type FilePreviewContext = {
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
    tail?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
    }
    mid?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
    }
}

interface PreviewOptions {
    headLines?: number
    tailLines?: number
    midLines?: number
}

const DEFAULT_HEAD_LINES = 50
const DEFAULT_TAIL_LINES = 20
const DEFAULT_MID_LINES = 20

const SANDBOX_SCRIPT_DIRECTORY = "/vercel/sandbox/lib/domain/dataset/file/scripts"

const PYTHON_SCRIPT_FILES = [
    "file_metadata.py",
    "preview_head_csv.py",
    "preview_head_excel.py",
    "preview_mid_csv.py",
    "preview_mid_excel.py",
    "preview_tail_csv.py",
    "preview_tail_excel.py",
]

const nodeRequire: NodeJS.Require = eval("require")

function resolveScriptPath(scriptName: string): string
{
    return nodeRequire.resolve(`@pulz-ar/core/dataset/file/scripts/${scriptName}`)
}

const preparedSandboxes = new WeakSet<Sandbox>()
const sandboxSetupPromises = new WeakMap<Sandbox, Promise<void>>()

function validateScriptResult(result: { stderr: string; stdout: string }, context: string): void
{
    if (!result.stderr)
    {
        return
    }

    const stderr = result.stderr.trim()
    if (stderr.length === 0)
    {
        return
    }

    if (stderr.includes("ModuleNotFoundError") || stderr.includes("Traceback") || stderr.includes("Error"))
    {
        throw new Error(`${context} failed: ${stderr.substring(0, 500)}`)
    }
}

export async function ensurePreviewScriptsAvailable(sandbox: Sandbox): Promise<void> {
    if (preparedSandboxes.has(sandbox)) {
        return
    }

    const inFlight = sandboxSetupPromises.get(sandbox)
    if (inFlight) {
        await inFlight
        return
    }

    const setupPromise = (async () => {
        try {
            await sandbox.runCommand({
                cmd: "mkdir",
                args: ["-p", SANDBOX_SCRIPT_DIRECTORY],
            })
        }
        catch (error) {
            console.warn("[Dataset Scripts] Failed to create sandbox scripts directory", error)
        }

        const filesToWrite = [] as { path: string; content: Buffer }[]

        for (const scriptName of PYTHON_SCRIPT_FILES) {
            try {
                const scriptPath = resolveScriptPath(scriptName)
                const fileBuffer = readFileSync(scriptPath)
                filesToWrite.push({
                    path: `${SANDBOX_SCRIPT_DIRECTORY}/${scriptName}`,
                    content: Buffer.from(fileBuffer),
                })
            }
            catch (error) {
                console.error(`[Dataset Scripts] Failed to read script ${scriptName}`, error)
                throw error
            }
        }

        if (filesToWrite.length > 0) {
            await sandbox.writeFiles(filesToWrite)
        }
    })()

    sandboxSetupPromises.set(sandbox, setupPromise)

    try {
        await setupPromise
        preparedSandboxes.add(sandbox)
    }
    catch (error) {
        sandboxSetupPromises.delete(sandbox)
        throw error
    }
}

export async function generateFilePreview(
    sandbox: Sandbox,
    sandboxFilePath: string,
    datasetId: string,
    options: PreviewOptions = {}
): Promise<FilePreviewContext> {
    const context: FilePreviewContext = {
        totalRows: 0,
    }

    try {
        await ensurePreviewScriptsAvailable(sandbox)

        const metadataResult = await runScript(
            sandbox,
            "file_metadata.py",
            [sandboxFilePath],
            "Extracts file metadata: name, extension, size, row count estimate, column count, and header preview"
        )
        context.metadata = metadataResult

        let isExcel = false
        if (metadataResult.stdout) {
            try {
                const metadataJson = JSON.parse(metadataResult.stdout)
                context.totalRows = metadataJson.row_count_estimate || 0
                const extension = metadataJson.extension || ""
                isExcel = extension === ".xlsx" || extension === ".xls"
            }
            catch {
                console.warn(`[Dataset ${datasetId}] Failed to parse metadata JSON`)
            }
        }

        const totalRows = context.totalRows
        const headLines = options.headLines || DEFAULT_HEAD_LINES
        const tailLines = options.tailLines || DEFAULT_TAIL_LINES

        if (totalRows === 0) {
            console.log(`[Dataset ${datasetId}] No rows detected, skipping preview`)
            return context
        }

        const headScript = isExcel ? "preview_head_excel.py" : "preview_head_csv.py"
        const tailScript = isExcel ? "preview_tail_excel.py" : "preview_tail_csv.py"
        const midScript = isExcel ? "preview_mid_excel.py" : "preview_mid_csv.py"

        if (totalRows <= headLines) {
            console.log(`[Dataset ${datasetId}] File has ${totalRows} rows, reading all with head only`)
            const headResult = await runScript(
                sandbox,
                headScript,
                [sandboxFilePath, String(totalRows)],
                `Reads the first ${totalRows} rows (entire file)`
            )
            validateScriptResult(headResult, `preview_head for ${datasetId}`)
            context.head = headResult
            return context
        }

        if (headLines + tailLines >= totalRows) {
            console.log(`[Dataset ${datasetId}] Head + tail would cover entire file (${totalRows} rows), reading all with head only`)
            const headResult = await runScript(
                sandbox,
                headScript,
                [sandboxFilePath, String(totalRows)],
                `Reads the first ${totalRows} rows (entire file)`
            )
            validateScriptResult(headResult, `preview_head for ${datasetId}`)
            context.head = headResult
            return context
        }

        console.log(`[Dataset ${datasetId}] Reading head (${headLines} rows) and tail (${tailLines} rows) from ${totalRows} total rows`)
        const headResult = await runScript(
            sandbox,
            headScript,
            [sandboxFilePath, String(headLines)],
            `Reads the first ${headLines} rows of the file`
        )
        validateScriptResult(headResult, `preview_head for ${datasetId}`)
        context.head = headResult

        const tailResult = await runScript(
            sandbox,
            tailScript,
            [sandboxFilePath, String(tailLines)],
            `Reads the last ${tailLines} rows of the file`
        )
        validateScriptResult(tailResult, `preview_tail for ${datasetId}`)
        context.tail = tailResult

        const midLines = options.midLines || DEFAULT_MID_LINES
        const gapSize = totalRows - headLines - tailLines

        if (gapSize > midLines) {
            const midStart = headLines
            const midEnd = totalRows - tailLines
            console.log(`[Dataset ${datasetId}] Large gap (${gapSize} rows), adding mid sample (${midLines} rows)`)
            const midResult = await runScript(
                sandbox,
                midScript,
                [sandboxFilePath, String(midStart), String(midEnd), String(midLines)],
                `Samples ${midLines} rows from the middle section (rows ${midStart + 1} to ${midEnd})`
            )
            validateScriptResult(midResult, `preview_mid for ${datasetId}`)
            context.mid = midResult
        }

    }
    catch (error) {
        console.error(`[Dataset ${datasetId}] Error generating file preview:`, error)
    }

    return context
}

async function runScript(
    sandbox: Sandbox,
    scriptName: string,
    args: string[],
    description: string
): Promise<{
    description: string
    script: string
    command: string
    stdout: string
    stderr: string
}> {
    const scriptPath = `/vercel/sandbox/lib/domain/dataset/file/scripts/${scriptName}`
    const command = `python ${scriptPath} ${args.join(" ")}`

    let scriptContent = ""

    try {
        const localScriptPath = resolveScriptPath(scriptName)
        scriptContent = readFileSync(localScriptPath, 'utf-8')
    }
    catch (error) {
        console.warn(`Failed to read script ${scriptName}:`, error)
    }

    try {
        const result = await sandbox.runCommand({
            cmd: "python",
            args: [scriptPath, ...args],
        })

        const stdout = await result.stdout()
        const stderr = await result.stderr()

        return {
            description,
            script: scriptContent,
            command,
            stdout: stdout || "",
            stderr: stderr || "",
        }
    }
    catch (error) {
        return {
            description,
            script: scriptContent,
            command,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
        }
    }
}

