import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import { defineAction, type ContextAction } from "@ekairos/events"
import { z } from "zod"

import { sandboxDomain } from "./actions.js"
import type { CommandResult } from "./commands.js"
import type { SandboxConfig, SandboxProvider } from "./types.js"

type AnyDomainRuntime = EkairosRuntime<Record<string, unknown>, any, any>
type SandboxRuntimeHandle<Runtime extends AnyDomainRuntime> = RuntimeForDomain<
  Runtime,
  typeof sandboxDomain
>

const SANDBOX_RUN_COMMAND_ACTION_NAME = "sandbox_run_command" as const

const sandboxRunCommandInputSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.unknown()).optional(),
    kind: z
      .enum(["command", "service", "codex-app-server", "dev-server", "test-runner", "watcher"])
      .optional(),
    mode: z.enum(["foreground", "background"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const sandboxRunCommandOutputSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  processId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  streamClientId: z.string().min(1).optional(),
  success: z.boolean(),
  exitCode: z.number().int().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  command: z.string().optional(),
  status: z.string().optional(),
  durationMs: z.number().optional(),
})

export type SandboxRunCommandInput = z.infer<typeof sandboxRunCommandInputSchema>
export type SandboxRunCommandOutput = z.infer<typeof sandboxRunCommandOutputSchema>
export type SandboxActions = {
  [SANDBOX_RUN_COMMAND_ACTION_NAME]: ContextAction<
    typeof sandboxRunCommandInputSchema,
    typeof sandboxRunCommandOutputSchema
  >
}

export type SerializedSandboxState = {
  version: 1
  sandboxId: string
  provider?: SandboxProvider
  externalSandboxId?: string
  runtime?: string
  ports?: number[]
  purpose?: string
}

export type SerializedSandbox = {
  runtime: SandboxRuntimeHandle<any>
  state: SerializedSandboxState
}

function cleanRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function asPorts(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ports = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0)
  return ports.length > 0 ? ports : undefined
}

async function readSandboxState(
  db: any,
  sandboxId: string,
): Promise<SerializedSandboxState> {
  const result = await db.query({
    sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
  })
  const row = result?.sandbox_sandboxes?.[0] ?? {}
  return cleanRecord({
    version: 1 as const,
    sandboxId,
    provider: asString(row.provider) as SandboxProvider | undefined,
    externalSandboxId: asString(row.externalSandboxId) || undefined,
    runtime: asString(row.runtime) || undefined,
    ports: asPorts(row.ports),
    purpose: asString(row.purpose) || undefined,
  })
}

function normalizeState(state: SerializedSandboxState): SerializedSandboxState {
  const sandboxId = asString(state.sandboxId).trim()
  if (!sandboxId) {
    throw new Error("Sandbox requires a sandboxId.")
  }
  return cleanRecord({
    version: 1 as const,
    sandboxId,
    provider: state.provider,
    externalSandboxId: asString(state.externalSandboxId).trim() || undefined,
    runtime: asString(state.runtime).trim() || undefined,
    ports: asPorts(state.ports),
    purpose: asString(state.purpose).trim() || undefined,
  })
}

export class Sandbox<Runtime extends AnyDomainRuntime = AnyDomainRuntime> {
  static readonly runCommandActionName = SANDBOX_RUN_COMMAND_ACTION_NAME
  static readonly runCommandInputSchema = sandboxRunCommandInputSchema
  static readonly runCommandOutputSchema = sandboxRunCommandOutputSchema

  private readonly runtime: SandboxRuntimeHandle<Runtime>
  private readonly stateValue: SerializedSandboxState

  private constructor(
    runtime: SandboxRuntimeHandle<Runtime>,
    state: SerializedSandboxState,
  ) {
    this.runtime = runtime
    this.stateValue = normalizeState(state)
  }

  static async create<Runtime extends AnyDomainRuntime>(
    runtime: SandboxRuntimeHandle<Runtime>,
    config: SandboxConfig,
  ): Promise<Sandbox<Runtime>> {
    "use step"
    const scoped = await runtime.use(sandboxDomain)
    const { SandboxService } = await import("./service.js")
    const service = new SandboxService(scoped.db as any)
    const created = await service.createSandbox(config)
    if (!created.ok) {
      throw new Error(created.error)
    }
    const state = await readSandboxState(scoped.db, created.data.sandboxId)
    return new Sandbox(runtime, state)
  }

  static from<Runtime extends AnyDomainRuntime>(
    runtime: SandboxRuntimeHandle<Runtime>,
    state: SerializedSandboxState,
  ): Sandbox<Runtime> {
    return new Sandbox(runtime, state)
  }

  static [WORKFLOW_SERIALIZE](instance: Sandbox<any>): SerializedSandbox {
    return {
      runtime: instance.runtime,
      state: instance.stateValue,
    }
  }

  static [WORKFLOW_DESERIALIZE](data: SerializedSandbox): Sandbox {
    return new Sandbox(data.runtime, data.state)
  }

  get sandboxId() {
    return this.stateValue.sandboxId
  }

  get state(): SerializedSandboxState {
    return { ...this.stateValue }
  }

  async runCommand(input: SandboxRunCommandInput): Promise<SandboxRunCommandOutput> {
    "use step"
    const parsed = sandboxRunCommandInputSchema.parse(input)

    const domain = await this.runtime.use(sandboxDomain)
    const run = await domain.actions.runCommandProcess({
      sandboxId: this.stateValue.sandboxId,
      command: parsed.command,
      args: parsed.args ?? [],
      cwd: parsed.cwd,
      env: parsed.env,
      kind: parsed.kind ?? "command",
      mode: parsed.mode ?? "foreground",
      metadata: {
        source: "sandbox.action",
        ...(parsed.metadata ?? {}),
      },
    })

    if (!run.ok) {
      return sandboxRunCommandOutputSchema.parse({
        sandboxId: this.stateValue.sandboxId,
        success: false,
        error: run.error,
        command:
          parsed.args && parsed.args.length > 0
            ? [parsed.command, ...parsed.args].join(" ")
            : parsed.command,
      })
    }

    const result = (run.data.result ?? {}) as Partial<CommandResult>
    const exitCode = asNumber(result.exitCode)
    return sandboxRunCommandOutputSchema.parse(
      cleanRecord({
        sandboxId: this.stateValue.sandboxId,
        processId: run.data.processId,
        streamId: run.data.streamId,
        streamClientId: run.data.streamClientId,
        success: Boolean(result.success ?? (exitCode === undefined || exitCode === 0)),
        exitCode,
        output: asString(result.output) || undefined,
        error: asString(result.error) || undefined,
        command: asString(result.command) || undefined,
        status: exitCode === undefined ? undefined : exitCode === 0 ? "exited" : "failed",
      }),
    )
  }

  actions(): SandboxActions {
    return {
      [SANDBOX_RUN_COMMAND_ACTION_NAME]: defineAction({
        description: "Run a shell command in this sandbox.",
        input: sandboxRunCommandInputSchema,
        output: sandboxRunCommandOutputSchema,
        execute: async ({ input }) => this.runCommand(input),
      }),
    } as const
  }
}
