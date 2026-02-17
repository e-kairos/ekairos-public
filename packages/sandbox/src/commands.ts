import { Sandbox } from "@vercel/sandbox"

export interface CommandResult {
  success: boolean
  exitCode?: number
  output?: string
  error?: string
  streamingLogs?: unknown[]
  command?: string
}

/**
 * Ejecuta un comando en un sandbox.
 *
 * Nota: sin logs con interpolación para respetar reglas del repo.
 */
export async function runCommandInSandbox(
  sandbox: Sandbox,
  command: string,
  args: string[] = [],
): Promise<CommandResult> {
  try {
    // @vercel/sandbox soporta { cmd, args } en runCommand
    const result = await sandbox.runCommand({ cmd: command, args })

    const stdout = (await result.stdout()) ?? ""
    const stderr = (await result.stderr()) ?? ""

    const fullCommand = args.length > 0 ? [command, ...args].join(" ") : command

    return {
      success: (result.exitCode ?? 0) === 0,
      exitCode: result.exitCode ?? 0,
      output: stdout,
      error: stderr,
      command: fullCommand,
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    const fullCommand = args.length > 0 ? [command, ...args].join(" ") : command
    return { success: false, error: message, command: fullCommand }
  }
}

