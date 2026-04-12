import { i } from "@instantdb/core"
import { defineDomainAction, domain, type DomainSchemaResult } from "@ekairos/domain"
import type { CommandResult } from "./commands.js"
import type { SandboxConfig } from "./types.js"

// Port de `ekairos-core/src/lib/domain/sandbox/schema.ts`
const sandboxSchemaDomain: DomainSchemaResult = domain("sandbox").schema({
  entities: {
    sandbox_sandboxes: i.entity({
      externalSandboxId: i.string().optional().indexed(),
      sandboxUserId: i.string().optional().indexed(),
      provider: i.string().indexed(),
      sandboxUrl: i.string().optional(),
      status: i.string().indexed(),
      timeout: i.number().optional(),
      runtime: i.string().optional(),
      vcpus: i.number().optional(),
      ports: i.json().optional(),
      purpose: i.string().optional().indexed(),
      params: i.json().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().optional().indexed(),
      shutdownAt: i.number().optional().indexed(),
    }),
    sandbox_processes: i.entity({
      kind: i.string().indexed(), // command | service | codex-app-server | dev-server | test-runner | watcher
      mode: i.string().indexed(), // foreground | background
      status: i.string().indexed(), // starting | running | detached | exited | failed | killed | lost
      provider: i.string().indexed(),
      command: i.string(),
      args: i.json().optional(),
      cwd: i.string().optional(),
      env: i.json().optional(),
      exitCode: i.number().optional().indexed(),
      signal: i.string().optional(),
      externalProcessId: i.string().optional().indexed(),
      streamId: i.string().optional().indexed(),
      streamClientId: i.string().optional().indexed(),
      streamStartedAt: i.number().optional().indexed(),
      streamFinishedAt: i.number().optional().indexed(),
      streamAbortReason: i.string().optional(),
      startedAt: i.number().indexed(),
      updatedAt: i.number().optional().indexed(),
      exitedAt: i.number().optional().indexed(),
      metadata: i.json().optional(),
    }),
  },
  links: {
    sandbox_user: {
      forward: {
        on: "sandbox_sandboxes",
        has: "one",
        label: "user",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "sandboxes",
      },
    },
    sandboxProcessSandbox: {
      forward: {
        on: "sandbox_processes",
        has: "one",
        label: "sandbox",
      },
      reverse: {
        on: "sandbox_sandboxes",
        has: "many",
        label: "processes",
      },
    },
    sandboxProcessStream: {
      forward: {
        on: "sandbox_processes",
        has: "one",
        label: "stream",
      },
      reverse: {
        on: "$streams" as any,
        has: "many",
        label: "sandboxProcesses",
      },
    },
  },
  rooms: {},
})

type ServiceResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
type SandboxRuntime = { use: (domain: unknown) => Promise<{ db: unknown }> }
type SandboxRunCommandInput = { sandboxId: string; command: string; args?: string[] }
type SandboxRunCommandProcessInput = SandboxRunCommandInput & {
  cwd?: string
  env?: Record<string, unknown>
  kind?: "command" | "service" | "codex-app-server" | "dev-server" | "test-runner" | "watcher"
  mode?: "foreground" | "background"
  metadata?: Record<string, unknown>
}
type SandboxProcessStreamChunk = {
  type: "stdout" | "stderr" | "status" | "exit" | "error" | "heartbeat" | "metadata"
  data?: Record<string, unknown>
}
type SandboxProcessRunResult = {
  processId: string
  streamId: string
  streamClientId: string
  result?: CommandResult
}

export async function createSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxConfig
}): Promise<ServiceResult<{ sandboxId: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).createSandbox(input)
}

export async function stopSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).stopSandbox(input.sandboxId)
}

export async function runCommandExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxRunCommandInput
}): Promise<ServiceResult<CommandResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).runCommand(input.sandboxId, input.command, input.args ?? [])
}

export async function runCommandProcessExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxRunCommandProcessInput
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).runCommandWithProcessStream(
    input.sandboxId,
    input.command,
    input.args ?? [],
    {
      cwd: input.cwd,
      env: input.env,
      kind: input.kind,
      mode: input.mode,
      metadata: input.metadata,
    },
  )
}

export async function readProcessStreamExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { processId: string }
}): Promise<ServiceResult<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).readProcessStream(input.processId)
}

export const sandboxDomain: DomainSchemaResult = sandboxSchemaDomain.actions({
  createSandbox: defineDomainAction<Record<string, unknown>, SandboxConfig, ServiceResult<{ sandboxId: string }>, SandboxRuntime>({
    name: "sandbox.createSandbox",
    execute: createSandboxExecute,
  }),
  stopSandbox: defineDomainAction<Record<string, unknown>, { sandboxId: string }, ServiceResult<void>, SandboxRuntime>({
    name: "sandbox.stopSandbox",
    execute: stopSandboxExecute,
  }),
  runCommand: defineDomainAction<Record<string, unknown>, SandboxRunCommandInput, ServiceResult<CommandResult>, SandboxRuntime>({
    name: "sandbox.runCommand",
    execute: runCommandExecute,
  }),
  runCommandProcess: defineDomainAction<
    Record<string, unknown>,
    SandboxRunCommandProcessInput,
    ServiceResult<SandboxProcessRunResult>,
    SandboxRuntime
  >({
    name: "sandbox.runCommandProcess",
    execute: runCommandProcessExecute,
  }),
  readProcessStream: defineDomainAction<
    Record<string, unknown>,
    { processId: string },
    ServiceResult<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }>,
    SandboxRuntime
  >({
    name: "sandbox.readProcessStream",
    execute: readProcessStreamExecute,
  }),
})

