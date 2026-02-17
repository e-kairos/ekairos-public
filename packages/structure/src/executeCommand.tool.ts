import { tool } from "ai"
import { z } from "zod/v4"
import { runDatasetSandboxCommandStep, writeDatasetSandboxTextFileStep } from "./sandbox/steps.js"
import { getDatasetWorkstation } from "./datasetFiles.js"

const MAX_STDOUT_CHARS = 20000
const MAX_STDERR_CHARS = 5000

interface ExecuteCommandToolParams {
  datasetId: string
  sandboxId: string
  env?: any
}

function normalizeScriptName(scriptName: string): string {
  // Keep the AI-provided scriptName, but:
  // - strip a trailing ".py" if it was included
  // - avoid extra dots/spaces in filenames
  const raw = String(scriptName ?? "").trim()
  const noExt = raw.toLowerCase().endsWith(".py") ? raw.slice(0, -3) : raw
  const cleaned = noExt
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/\s+/g, "_")
    .replace(/\./g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
  return cleaned.length > 0 ? cleaned : "script"
}

export function createExecuteCommandTool({ datasetId, sandboxId, env }: ExecuteCommandToolParams) {
  return tool({
    description:
      "Execute Python scripts in the sandbox. Always saves script to a file before executing. The tool's output is EXACTLY the script's stdout and includes the script file path for traceability. CRITICAL: Print concise, human-readable summaries only; do NOT print raw large data. For big results, write artifacts to files in the workstation and print their file paths. Always include progress/result prints.",
    inputSchema: z.object({
      pythonCode: z
        .string()
        .describe(
          "Python code to execute. Saved to a file before running. MANDATORY: Use print() to report progress and final results. Keep prints concise; avoid dumping rows/JSON.",
        ),
      scriptName: z
        .string()
        .describe(
          "Name for the script file in snake_case (e.g., 'inspect_file', 'parse_csv', 'generate_output'). The file will be saved as <scriptName>.py in the workstation.",
        ),
    }),
    execute: async ({ pythonCode, scriptName }: { pythonCode: string; scriptName: string }) => {
      const workstation = getDatasetWorkstation(datasetId)
      const scriptNameWithExt = `${normalizeScriptName(scriptName)}.py`
      const scriptFile = `${workstation}/${scriptNameWithExt}`

      await writeDatasetSandboxTextFileStep({
        env,
        sandboxId,
        path: scriptFile,
        text: pythonCode,
      })

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

      if (exitCode !== 0) {
        return {
          success: false,
          exitCode,
          stdout: stdoutCapped,
          stderr: stderrCapped,
          scriptPath: scriptFile,
          error: "Command failed",
          stdoutTruncated: isStdoutTruncated,
          stderrTruncated: isStderrTruncated,
          stdoutOriginalLength: stdout.length,
          stderrOriginalLength: stderr.length,
        }
      }

      if (stderr && (stderr.includes("Traceback") || stderr.toLowerCase().includes("error"))) {
        return {
          success: false,
          exitCode,
          stdout: stdoutCapped,
          stderr: stderrCapped,
          scriptPath: scriptFile,
          error: "Python error detected",
          stdoutTruncated: isStdoutTruncated,
          stderrTruncated: isStderrTruncated,
          stdoutOriginalLength: stdout.length,
          stderrOriginalLength: stderr.length,
        }
      }

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
    },
  })
}

