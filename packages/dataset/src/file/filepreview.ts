import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import type { FilePreviewContext } from "./filepreview.types.js"
import { PYTHON_SCRIPT_BASE64_BY_NAME } from "./scripts.generated.js"

export type { FilePreviewContext } from "./filepreview.types.js"

interface PreviewOptions {
    headLines?: number
    tailLines?: number
    midLines?: number
}

const DEFAULT_HEAD_LINES = 50
const DEFAULT_TAIL_LINES = 20
const DEFAULT_MID_LINES = 20

const SANDBOX_SCRIPT_DIRECTORY = "/tmp/ekairos/dataset/file/scripts"

const PYTHON_SCRIPT_FILES = [
    "file_metadata.py",
    "preview_head_csv.py",
    "preview_head_excel.py",
    "preview_mid_csv.py",
    "preview_mid_excel.py",
    "preview_tail_csv.py",
    "preview_tail_excel.py",
]

export function resolveFilePreviewScriptPath(scriptName: string): string {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    const taskRoot = String(process.env.LAMBDA_TASK_ROOT ?? "").trim()
    const candidates = [
        join(currentDir, "scripts", scriptName),
        join(process.cwd(), "node_modules", "@ekairos", "dataset", "dist", "file", "scripts", scriptName),
        taskRoot
            ? join(taskRoot, "node_modules", "@ekairos", "dataset", "dist", "file", "scripts", scriptName)
            : "",
        join(process.cwd(), "packages", "dataset", "dist", "file", "scripts", scriptName),
        join(process.cwd(), "packages", "dataset", "src", "file", "scripts", scriptName),
    ].filter(Boolean)

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate
        }
    }

    throw new Error(
        `dataset_preview_script_not_found:${scriptName}; searched=${candidates.join(",")}`,
    )
}

export function getEmbeddedFilePreviewScriptBase64(scriptName: string): string {
    const embedded = PYTHON_SCRIPT_BASE64_BY_NAME[scriptName]

    if (!embedded) {
        throw new Error(`dataset_preview_script_not_embedded:${scriptName}`)
    }

    return embedded
}

function readFilePreviewScriptBase64(scriptName: string): string {
    try {
        const scriptPath = resolveFilePreviewScriptPath(scriptName)
        return Buffer.from(readFileSync(scriptPath)).toString("base64")
    }
    catch (error) {
        try {
            return getEmbeddedFilePreviewScriptBase64(scriptName)
        }
        catch {
            throw error
        }
    }
}

function readFilePreviewScriptText(scriptName: string): string {
    try {
        const scriptPath = resolveFilePreviewScriptPath(scriptName)
        return readFileSync(scriptPath, "utf-8")
    }
    catch {
        return Buffer.from(getEmbeddedFilePreviewScriptBase64(scriptName), "base64").toString("utf-8")
    }
}

const preparedSandboxIds = new Set<string>()
const sandboxSetupPromises = new Map<string, Promise<void>>()

type PreviewKind = "excel" | "text"

function sanitizePreviewText(value: unknown): string {
    return String(value ?? "")
        .replace(/\u0000/g, "")
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

function getPreviewKind(extension: string): PreviewKind | null {
    const normalized = extension.toLowerCase()
    if (normalized === ".xlsx" || normalized === ".xls") return "excel"
    if (
        normalized === ".csv" ||
        normalized === ".tsv" ||
        normalized === ".txt" ||
        normalized === ".log" ||
        normalized === ".json" ||
        normalized === ".jsonl" ||
        normalized === ".md"
    ) {
        return "text"
    }
    return null
}

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

export async function ensurePreviewScriptsAvailable(runtime: any, sandboxId: string): Promise<void> {
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
                runtime,
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
                filesToWrite.push({
                    path: `${SANDBOX_SCRIPT_DIRECTORY}/${scriptName}`,
                    contentBase64: readFilePreviewScriptBase64(scriptName),
                })
            }
            catch (error) {
                console.error(`[Dataset Scripts] Failed to read script ${scriptName}`, error)
                throw error
            }
        }

        if (filesToWrite.length > 0) {
            await writeDatasetSandboxFilesStep({
                runtime,
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
    runtime: any,
    sandboxId: string,
    sandboxFilePath: string,
    datasetId: string,
    options: PreviewOptions = {}
): Promise<FilePreviewContext> {
    const context: FilePreviewContext = {
        totalRows: 0,
    }

    try {
        await ensurePreviewScriptsAvailable(runtime, sandboxId)

        const metadataResult = await runScript(
            runtime,
            sandboxId,
            "file_metadata.py",
            [sandboxFilePath],
            "Extracts file metadata: name, extension, size, row count estimate, column count, and header preview"
        )
        context.metadata = metadataResult

        let previewKind: PreviewKind | null = null
        if (metadataResult.stdout) {
            try {
                const metadataJson = JSON.parse(metadataResult.stdout)
                context.totalRows = metadataJson.row_count_estimate || 0
                const extension = metadataJson.extension || ""
                previewKind = getPreviewKind(extension)
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

        if (!previewKind) {
            console.log(`[Dataset ${datasetId}] Binary or unsupported preview format, keeping metadata only`)
            return context
        }

        const headScript = previewKind === "excel" ? "preview_head_excel.py" : "preview_head_csv.py"
        const tailScript = previewKind === "excel" ? "preview_tail_excel.py" : "preview_tail_csv.py"
        const midScript = previewKind === "excel" ? "preview_mid_excel.py" : "preview_mid_csv.py"

        if (totalRows <= headLines) {
            console.log(`[Dataset ${datasetId}] File has ${totalRows} rows, reading all with head only`)
            const headResult = await runScript(
                runtime,
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
                runtime,
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
            runtime,
            sandboxId,
            headScript,
            [sandboxFilePath, String(headLines)],
            `Reads the first ${headLines} rows of the file`
        )
        validateScriptResult(headResult, `preview_head for ${datasetId}`)
        context.head = headResult

        const tailResult = await runScript(
            runtime,
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
                runtime,
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
    runtime: any,
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
    const scriptPath = `${SANDBOX_SCRIPT_DIRECTORY}/${scriptName}`
    const command = `python ${scriptPath} ${args.join(" ")}`

    let scriptContent = ""

    try {
        scriptContent = readFilePreviewScriptText(scriptName)
    }
    catch (error) {
        console.warn(`Failed to read script ${scriptName}:`, error)
    }

    try {
        const result = await runDatasetSandboxCommandStep({
            runtime,
            sandboxId,
            cmd: "python",
            args: [scriptPath, ...args],
        })

        return {
            description,
            script: scriptContent,
            command,
            stdout: sanitizePreviewText(result.stdout),
            stderr: sanitizePreviewText(result.stderr),
        }
    }
    catch (error) {
        return {
            description,
            script: scriptContent,
            command,
            stdout: "",
            stderr: sanitizePreviewText(error instanceof Error ? error.message : String(error)),
        }
    }
}

