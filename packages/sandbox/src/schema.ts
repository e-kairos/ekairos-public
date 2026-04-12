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
type SandboxFileInput = { path: string; contentBase64: string }
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
type SandboxAuthInstallInput = {
  sandboxId: string
  codexHome?: string
  authJsonPath?: string
  credentialsJsonPath?: string
  configTomlPath?: string
}
type SandboxCreateEkairosAppInput = {
  sandboxId: string
  appDir: string
  packageManager?: string
  instantTokenEnvName?: string
}

function shSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
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

export async function writeFilesExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; files: SandboxFileInput[] }
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).writeFiles(input.sandboxId, input.files)
}

export async function readFileExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; path: string }
}): Promise<ServiceResult<{ contentBase64: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).readFile(input.sandboxId, input.path)
}

export async function installCodexAuthExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxAuthInstallInput
}): Promise<ServiceResult<{ authJson: boolean; credentialsJson: boolean; configToml: boolean }>> {
  "use step"
  const { existsSync, readFileSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { homedir } = await import("node:os")
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  const codexHome = String(input.codexHome ?? "/home/sprite/.codex").trim() || "/home/sprite/.codex"
  const localCodexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  const candidates = {
    authJson: String(input.authJsonPath ?? "").trim() || join(localCodexHome, "auth.json"),
    credentialsJson:
      String(input.credentialsJsonPath ?? "").trim() || join(localCodexHome, ".credentials.json"),
    configToml: String(input.configTomlPath ?? "").trim() || join(localCodexHome, "config.toml"),
  }
  const files: SandboxFileInput[] = []
  const copied = { authJson: false, credentialsJson: false, configToml: false }
  if (existsSync(candidates.authJson)) {
    files.push({
      path: `${codexHome}/auth.json`,
      contentBase64: readFileSync(candidates.authJson).toString("base64"),
    })
    copied.authJson = true
  }
  if (existsSync(candidates.credentialsJson)) {
    files.push({
      path: `${codexHome}/.credentials.json`,
      contentBase64: readFileSync(candidates.credentialsJson).toString("base64"),
    })
    copied.credentialsJson = true
  }
  if (existsSync(candidates.configToml)) {
    files.push({
      path: `${codexHome}/config.toml`,
      contentBase64: readFileSync(candidates.configToml).toString("base64"),
    })
    copied.configToml = true
  }
  if (!copied.authJson && !copied.credentialsJson) {
    return { ok: false, error: "codex_auth_file_not_found" }
  }
  const wrote = await new SandboxService(scoped.db as any).writeFiles(input.sandboxId, files)
  if (!wrote.ok) return wrote
  return { ok: true, data: copied }
}

export async function getSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<Record<string, unknown>>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const result = await (scoped.db as any).query({
    sandbox_sandboxes: { $: { where: { id: input.sandboxId } as any, limit: 1 } },
  })
  const row = result?.sandbox_sandboxes?.[0]
  if (!row) return { ok: false, error: "sandbox_not_found" }
  return { ok: true, data: row }
}

export async function createCheckpointExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; comment?: string }
}): Promise<ServiceResult<{ checkpointId: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).createCheckpoint(input.sandboxId, {
    comment: input.comment,
  })
}

export async function createEkairosAppExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxCreateEkairosAppInput
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  const service = new SandboxService(scoped.db as any)
  const appDir = String(input.appDir ?? "").trim() || "/workspace/ekairos-app"
  const tokenEnv = String(input.instantTokenEnvName ?? "INSTANT_PERSONAL_ACCESS_TOKEN").trim()
  const instantToken = String(process.env[tokenEnv] ?? "").trim()
  if (!instantToken) return { ok: false, error: `instant_token_env_missing:${tokenEnv}` }
  const tokenPath = `/tmp/ekairos-instant-token-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const wrote = await service.writeFiles(input.sandboxId, [
    {
      path: tokenPath,
      contentBase64: Buffer.from(instantToken, "utf8").toString("base64"),
    },
  ])
  if (!wrote.ok) return wrote
  const resultPath = `/tmp/ekairos-create-app-${Date.now()}.json`
  const packageManager = String(input.packageManager ?? "pnpm").trim() || "pnpm"
  const command = [
    "set -euo pipefail",
    `TOKEN="$(cat ${shSingleQuote(tokenPath)})"`,
    `rm -f ${shSingleQuote(tokenPath)}`,
    `rm -rf ${shSingleQuote(appDir)}`,
    `npx -y @ekairos/domain@beta create-app ${shSingleQuote(appDir)} --next --no-install --json --package-manager=${shSingleQuote(packageManager)} --instantToken="$TOKEN" > ${shSingleQuote(resultPath)}`,
    `node -e 'const fs=require("fs"); const p=require(${JSON.stringify(`${appDir}/package.json`)}); const r=JSON.parse(fs.readFileSync(${JSON.stringify(resultPath)}, "utf8")); console.log(JSON.stringify({ok:r.ok, provisioned:r.data?.provisioned, appId:r.data?.appId, packageName:p.name, ekairosDomain:p.dependencies?.["@ekairos/domain"], workflow:p.dependencies?.workflow}))'`,
    "echo sandbox_create_ekairos_app_ok",
  ].join("\n")
  return await service.runCommandWithProcessStream(input.sandboxId, "sh", ["-lc", command], {
    kind: "command",
    mode: "foreground",
    metadata: { source: "sandbox.domain", label: "create-ekairos-app" },
  })
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
  writeFiles: defineDomainAction<
    Record<string, unknown>,
    { sandboxId: string; files: SandboxFileInput[] },
    ServiceResult<void>,
    SandboxRuntime
  >({
    name: "sandbox.writeFiles",
    execute: writeFilesExecute,
  }),
  readFile: defineDomainAction<
    Record<string, unknown>,
    { sandboxId: string; path: string },
    ServiceResult<{ contentBase64: string }>,
    SandboxRuntime
  >({
    name: "sandbox.readFile",
    execute: readFileExecute,
  }),
  installCodexAuth: defineDomainAction<
    Record<string, unknown>,
    SandboxAuthInstallInput,
    ServiceResult<{ authJson: boolean; credentialsJson: boolean; configToml: boolean }>,
    SandboxRuntime
  >({
    name: "sandbox.installCodexAuth",
    execute: installCodexAuthExecute,
  }),
  getSandbox: defineDomainAction<
    Record<string, unknown>,
    { sandboxId: string },
    ServiceResult<Record<string, unknown>>,
    SandboxRuntime
  >({
    name: "sandbox.getSandbox",
    execute: getSandboxExecute,
  }),
  createCheckpoint: defineDomainAction<
    Record<string, unknown>,
    { sandboxId: string; comment?: string },
    ServiceResult<{ checkpointId: string }>,
    SandboxRuntime
  >({
    name: "sandbox.createCheckpoint",
    execute: createCheckpointExecute,
  }),
  createEkairosApp: defineDomainAction<
    Record<string, unknown>,
    SandboxCreateEkairosAppInput,
    ServiceResult<SandboxProcessRunResult>,
    SandboxRuntime
  >({
    name: "sandbox.createEkairosApp",
    execute: createEkairosAppExecute,
  }),
})

