import { readFileSync } from "fs"
import { join } from "path"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps"

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

function resolveScriptPath(scriptName: string): string {
    // Prefer local scripts in src/ (tests/dev), and after build the scripts are copied to dist/
    // at the same relative path, so this works in both environments.
    return join(__dirname, "scripts", scriptName)
}

const preparedSandboxIds = new Set<string>()
const sandboxSetupPromises = new Map<string, Promise<void>>()

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

export async function ensurePreviewScriptsAvailable(env: any, sandboxId: string): Promise<void> {
    if (preparedSandboxIds.has(sandboxId)) {
        return
    }

    const inFlight = sandboxSetupPromises.get(sandboxId)
    if (inFlight) {
        await inFlight
        return
    }

    const setupPromise = (async () => {
        try {
            await runDatasetSandboxCommandStep({
                env,
                sandboxId,
                cmd: "mkdir",
                args: ["-p", SANDBOX_SCRIPT_DIRECTORY],
            })
        }
        catch (error) {
            console.warn("[Dataset Scripts] Failed to create sandbox scripts directory", error)
        }

        const filesToWrite = [] as { path: string; contentBase64: string }[]

        for (const scriptName of PYTHON_SCRIPT_FILES) {
            try {
                const scriptPath = resolveScriptPath(scriptName)
                const fileBuffer = readFileSync(scriptPath)
                filesToWrite.push({
                    path: `${SANDBOX_SCRIPT_DIRECTORY}/${scriptName}`,
                    contentBase64: Buffer.from(fileBuffer).toString("base64"),
                })
            }
            catch (error) {
                console.error(`[Dataset Scripts] Failed to read script ${scriptName}`, error)
                throw error
            }
        }

        if (filesToWrite.length > 0) {
            await writeDatasetSandboxFilesStep({
                env,
                sandboxId,
                files: filesToWrite,
            })
        }
    })()

    sandboxSetupPromises.set(sandboxId, setupPromise)

    try {
        await setupPromise
        preparedSandboxIds.add(sandboxId)
    }
    catch (error) {
        sandboxSetupPromises.delete(sandboxId)
        throw error
    }
}

export async function generateFilePreview(
    env: any,
    sandboxId: string,
    sandboxFilePath: string,
    datasetId: string,
    options: PreviewOptions = {}
): Promise<FilePreviewContext> {
    const context: FilePreviewContext = {
        totalRows: 0,
    }

    try {
        await ensurePreviewScriptsAvailable(env, sandboxId)

        const metadataResult = await runScript(
            env,
            sandboxId,
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
                env,
                sandboxId,
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
                env,
                sandboxId,
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
            env,
            sandboxId,
            headScript,
            [sandboxFilePath, String(headLines)],
            `Reads the first ${headLines} rows of the file`
        )
        validateScriptResult(headResult, `preview_head for ${datasetId}`)
        context.head = headResult

        const tailResult = await runScript(
            env,
            sandboxId,
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
                env,
                sandboxId,
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
    env: any,
    sandboxId: string,
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
        const result = await runDatasetSandboxCommandStep({
            env,
            sandboxId,
            cmd: "python",
            args: [scriptPath, ...args],
        })

        return {
            description,
            script: scriptContent,
            command,
            stdout: result.stdout || "",
            stderr: result.stderr || "",
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

