import { tool } from "ai"
import { z } from "zod"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "./sandbox/steps"
import { getDatasetWorkstation } from "./datasetFiles"

// To keep responses predictable for big data scenarios, we cap stdout/stderr.
// The tool's return payload exposes stdout (capped) plus the on-disk script path.
const MAX_STDOUT_CHARS = 20000
const MAX_STDERR_CHARS = 5000

interface ExecuteCommandToolParams {
    datasetId: string
    sandboxId: string
    env?: any
}

export function createExecuteCommandTool({ datasetId, sandboxId, env }: ExecuteCommandToolParams) {
    return tool({
        description: "Execute Python scripts in the sandbox. Always saves script to a file before executing. The tool's output is EXACTLY the script's stdout and includes the script file path for traceability. CRITICAL: Print concise, human-readable summaries only; do NOT print raw large data. For big results, write artifacts to files in the workstation and print their file paths. Always include progress/result prints (e.g., 'Processing file X...', 'Found Y records', 'Generated output.csv').",
        inputSchema: z.object({
            pythonCode: z.string().describe("Python code to execute. Saved to a file before running. MANDATORY: Use print() to report progress and final results. Keep prints concise; avoid dumping rows/JSON. For large outputs, write to files in the workstation directory and print only file paths and brief summaries."),
            scriptName: z.string().describe("Name for the script file in snake_case (e.g., 'inspect_file', 'parse_csv', 'generate_dataset'). A UUID will be appended automatically."),
        }),
        execute: async ({ pythonCode, scriptName }: { pythonCode: string; scriptName: string }) => {
            const uuid = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
            const workstation = getDatasetWorkstation(datasetId)
            const scriptFile = `${workstation}/${scriptName}-${uuid}.py`

            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: executeCommand`)
            console.log(`[Dataset ${datasetId}] Script: ${scriptName}`)
            console.log(`[Dataset ${datasetId}] File: ${scriptFile}`)
            console.log(`[Dataset ${datasetId}] Code length: ${pythonCode.length} chars`)
            console.log(`[Dataset ${datasetId}] ========================================`)

            try {
                await writeDatasetSandboxFilesStep({
                    env,
                    sandboxId,
                    files: [
                        {
                    path: scriptFile,
                            contentBase64: Buffer.from(pythonCode, "utf-8").toString("base64"),
                        },
                    ],
                })

                console.log(`[Dataset ${datasetId}] Script written to: ${scriptFile}`)
                console.log(`[Dataset ${datasetId}] Executing: python ${scriptFile}`)

                const result = await runDatasetSandboxCommandStep({
                    env,
                    sandboxId,
                    cmd: "python",
                    args: [scriptFile],
                })

                const stdout = result.stdout || ""
                const stderr = result.stderr || ""
                const exitCode = result.exitCode

                const isStdoutTruncated = stdout.length > MAX_STDOUT_CHARS
                const isStderrTruncated = stderr.length > MAX_STDERR_CHARS

                const stdoutCapped = isStdoutTruncated ? stdout.slice(0, MAX_STDOUT_CHARS) : stdout
                const stderrCapped = isStderrTruncated ? stderr.slice(0, MAX_STDERR_CHARS) : stderr

                if (exitCode !== 0)
                {
                    console.error(`[Dataset ${datasetId}] ❌ Command failed with exit code ${exitCode}`)
                    console.error(`[Dataset ${datasetId}] Stderr:`, stderrCapped.substring(0, 500))
                    console.error(`[Dataset ${datasetId}] ========================================`)

                    return {
                        success: false,
                        exitCode,
                        stdout: stdoutCapped,
                        stderr: stderrCapped,
                        scriptPath: scriptFile,
                        error: `Command failed with exit code ${exitCode}`,
                        stdoutTruncated: isStdoutTruncated,
                        stderrTruncated: isStderrTruncated,
                        stdoutOriginalLength: stdout.length,
                        stderrOriginalLength: stderr.length,
                    }
                }

                if (stderr && (stderr.includes("Traceback") || stderr.toLowerCase().includes("error")))
                {
                    console.error(`[Dataset ${datasetId}] ❌ Python error detected`)
                    console.error(`[Dataset ${datasetId}] Stderr:`, stderrCapped.substring(0, 500))
                    console.error(`[Dataset ${datasetId}] ========================================`)

                    return {
                        success: false,
                        exitCode,
                        stdout: stdoutCapped,
                        stderr: stderrCapped,
                        scriptPath: scriptFile,
                        error: "Python error detected in stderr",
                        stdoutTruncated: isStdoutTruncated,
                        stderrTruncated: isStderrTruncated,
                        stdoutOriginalLength: stdout.length,
                        stderrOriginalLength: stderr.length,
                    }
                }

                console.log(`[Dataset ${datasetId}] ✅ Command executed successfully`)
                if (stdout)
                {
                    console.log(`[Dataset ${datasetId}] Output length: ${stdout.length} chars`)
                    if (isStdoutTruncated)
                    {
                        console.log(`[Dataset ${datasetId}] ⚠️  Stdout truncated to ${MAX_STDOUT_CHARS} chars`)
                    }
                }
                console.log(`[Dataset ${datasetId}] ========================================`)

                return {
                    success: true,
                    exitCode,
                    stdout: stdoutCapped,
                    stderr: stderrCapped,
                    scriptPath: scriptFile,
                    message: "Command executed successfully",
                    stdoutTruncated: isStdoutTruncated,
                    stderrTruncated: isStderrTruncated,
                    stdoutOriginalLength: stdout.length,
                    stderrOriginalLength: stderr.length,
                }
            }
            catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error"
                console.error(`[Dataset ${datasetId}] executeCommand failed:`, errorMessage)
                console.error(`[Dataset ${datasetId}] ========================================`)

                return {
                    success: false,
                    error: errorMessage,
                    stdout: "",
                    stderr: "",
                    exitCode: -1,
                    scriptPath: scriptFile,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutOriginalLength: 0,
                    stderrOriginalLength: 0,
                }
            }
        },
    })
}

