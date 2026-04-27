/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../domain/src/runtime-handle.ts"
import { configureRuntime } from "../../domain/src/runtime.ts"
import { createContext, eventsDomain } from "@ekairos/events"
import { sandboxDomain, SandboxService } from "../../sandbox/src/index.ts"
import { createCodexReactor, type CodexConfig } from "../openai-reactor/src/index.js"
import { createTestApp } from "../../ekairos-test/src/provision.ts"
import { config as dotenvConfig } from "dotenv"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

dotenvConfig({ path: "C:/ek/.env.local", quiet: true })

const TEST_TIMEOUT_MS = 15 * 60 * 1000

const appDomain = domain("codex-sandbox-command-process-tests")
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
  runtime?: CodexSandboxCommandRuntime
}

class CodexSandboxCommandRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb(env: TestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function rows(snapshot: any, key: string): any[] {
  return Array.isArray(snapshot?.[key]) ? snapshot[key] : []
}

function getInstantProvisionToken() {
  const raw = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function getCodexAuthPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  return join(codexHome, "auth.json")
}

function getCodexConfigPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  const configPath = join(codexHome, "config.toml")
  return existsSync(configPath) ? configPath : undefined
}

function hasRealSandboxEnv() {
  return Boolean(
    getInstantProvisionToken() &&
      String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TOKEN ?? process.env.VERCEL_OIDC_TOKEN ?? "").trim() &&
      existsSync(getCodexAuthPath()),
  )
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|authorization|authJson|credential/i.test(key)) {
      out[key] = typeof entry === "string" ? `[redacted:${entry.length}]` : "[redacted]"
    } else {
      out[key] = redact(entry)
    }
  }
  return out
}

const describeReal = hasRealSandboxEnv() ? describe : describe.skip

describeReal("codex commandExecution observed sandbox process on Vercel", () => {
  let appId = ""
  let adminToken = ""
  let runtime: CodexSandboxCommandRuntime | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `codex-command-process-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new CodexSandboxCommandRuntime({
      actorId: "codex-command-process-test-user",
      appId,
      adminToken,
      authJsonPath: getCodexAuthPath(),
      configTomlPath: getCodexConfigPath(),
    })
    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db: await runtime!.db() }),
    })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (sandboxId && appId && adminToken) {
      const db = init({
        appId,
        adminToken,
        schema: appDomain.toInstantSchema(),
        useDateObjects: true,
      } as any)
      await new SandboxService(db as any).stopSandbox(sandboxId).catch(() => {})
    }
  }, 5 * 60 * 1000)

  it("creates a sandbox_processes row and stream for a Codex commandExecution", async () => {
    if (!runtime) throw new Error("runtime_not_initialized")

    const marker = `OBSERVED_PROCESS_OK_${Date.now()}`
    const contextKey = `codex-command-process:${Date.now()}`
    const repoPath = "/vercel/sandbox"

    const codexContext = createContext<TestEnv>("codex.sandbox.command-process.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: repoPath,
      }))
      .narrative(() => "Run exactly the shell commands the user asks for; do not invent alternatives.")
      .actions(() => ({}))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          includeReasoningPart: true,
          includeStreamTraceInOutput: true,
          includeRawProviderChunksInOutput: true,
          maxPersistedStreamChunks: 1000,
          resolveConfig: async ({ env }) => ({
            mode: "sandbox",
            appServerUrl: "sandbox://internal",
            repoPath,
            approvalPolicy: "never",
            sandbox: {
              provider: "vercel",
              runtime: "node22",
              purpose: "codex-command-process-e2e",
              vercel: {
                profile: "ephemeral",
                deleteOnStop: true,
                cwd: "C:/ek",
                scope: "ekairos-dev",
              },
              authJsonPath: env.authJsonPath,
              configTomlPath: env.configTomlPath,
              createApp: false,
              installApp: false,
              startApp: false,
              checkpoint: false,
              bridgePort: 4503,
              appPort: 3000,
            },
          }),
        }),
      )
      .shouldContinue(() => false)
      .build()

    const triggerEvent = {
      id: crypto.randomUUID(),
      type: "input",
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [
          {
            type: "text",
            text: [
              "Run this exact shell command and then answer with exactly the output:",
              `printf ${marker}`,
              "Do not write files.",
            ].join("\n"),
          },
        ],
      },
    } as any

    const shell = await codexContext.react(triggerEvent, {
      env: { ...runtime.env, runtime } as any,
      runtime,
      context: { key: contextKey },
      durable: false,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
        silent: false,
      },
    })
    const result = await shell.run!

    const db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    const service = new SandboxService(db as any)

    const snapshot: any = await db.query({
      event_contexts: { $: { where: { id: result.context.id as any }, limit: 1 } },
      event_executions: { $: { where: { id: result.execution.id as any }, limit: 1 } },
      event_steps: {
        $: { where: { "execution.id": result.execution.id }, limit: 20, order: { createdAt: "asc" } },
      },
      event_items: {
        $: { where: { "context.id": result.context.id }, limit: 20, order: { createdAt: "asc" } },
      },
      sandbox_sandboxes: { $: { limit: 20, order: { createdAt: "asc" } } },
      sandbox_processes: { $: { limit: 50, order: { startedAt: "asc" } } },
    })

    const sandboxes = rows(snapshot, "sandbox_sandboxes")
    sandboxId = asString(sandboxes[0]?.id)
    const processRows = rows(snapshot, "sandbox_processes")
    const codexCommandProcess = processRows.find(
      (row) => asString(row?.metadata?.source) === "codex.commandExecution",
    )
    expect(codexCommandProcess).toBeTruthy()

    const stream = await service.readProcessStream(asString(codexCommandProcess.id))
    if (!stream.ok) throw new Error(stream.error)
    const stdoutText = stream.data.chunks
      .filter((chunk) => chunk.type === "stdout")
      .map((chunk) => asString(chunk.data?.text))
      .join("")
    const exitChunk = [...stream.data.chunks].reverse().find((chunk) => chunk.type === "exit")

    const report = redact({
      appId,
      marker,
      contextId: result.context.id,
      executionId: result.execution.id,
      reactionId: result.reaction.id,
      sandboxId,
      entities: {
        event_contexts: rows(snapshot, "event_contexts"),
        event_executions: rows(snapshot, "event_executions"),
        event_steps: rows(snapshot, "event_steps"),
        event_items: rows(snapshot, "event_items"),
        sandbox_sandboxes: sandboxes,
        sandbox_processes: processRows,
      },
      codexCommandProcess,
      codexCommandProcessStream: stream.data,
      derived: {
        stdoutText,
        exitChunk,
      },
    })
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `codex-sandbox-command-process-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[codex-sandbox-command-process] ${reportPath}`)
    console.log(
      JSON.stringify(
        {
          processId: asString(codexCommandProcess.id),
          streamClientId: asString(codexCommandProcess.streamClientId),
          command: asString(codexCommandProcess.command),
          status: asString(codexCommandProcess.status),
          stdoutText,
          chunks: stream.data.chunks.map((chunk) => ({
            seq: chunk.seq,
            type: chunk.type,
            data: chunk.data,
          })),
        },
        null,
        2,
      ),
    )

    expect(sandboxId).not.toBe("")
    expect(asString(codexCommandProcess.status)).toBe("exited")
    expect(asString(codexCommandProcess.command)).toContain("printf")
    expect(stdoutText).toContain(marker)
    expect(asString(exitChunk?.data?.status)).toBe("exited")
  }, TEST_TIMEOUT_MS)

  it("streams a more complex Codex commandExecution into the observed sandbox process", async () => {
    if (!runtime) throw new Error("runtime_not_initialized")

    const marker = `OBSERVED_COMPLEX_OK_${Date.now()}`
    const contextKey = `codex-command-process-complex:${Date.now()}`
    const repoPath = "/vercel/sandbox"
    const script = [
      "set -e",
      "echo complex-start",
      "printf 'alpha-line\\n'",
      "printf 'stderr-line\\n' >&2",
      `printf '${marker}\\n'`,
      "echo complex-end",
    ].join("; ")

    const codexContext = createContext<TestEnv>("codex.sandbox.command-process-complex.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: repoPath,
      }))
      .narrative(() => "Run exactly the shell commands the user asks for; do not invent alternatives.")
      .actions(() => ({}))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          includeReasoningPart: true,
          includeStreamTraceInOutput: true,
          includeRawProviderChunksInOutput: true,
          maxPersistedStreamChunks: 1000,
          resolveConfig: async ({ env }) => ({
            mode: "sandbox",
            appServerUrl: "sandbox://internal",
            repoPath,
            approvalPolicy: "never",
            sandbox: {
              provider: "vercel",
              runtime: "node22",
              purpose: "codex-command-process-complex-e2e",
              vercel: {
                profile: "ephemeral",
                deleteOnStop: true,
                cwd: "C:/ek",
                scope: "ekairos-dev",
              },
              authJsonPath: env.authJsonPath,
              configTomlPath: env.configTomlPath,
              createApp: false,
              installApp: false,
              startApp: false,
              checkpoint: false,
              bridgePort: 4504,
              appPort: 3000,
            },
          }),
        }),
      )
      .shouldContinue(() => false)
      .build()

    const triggerEvent = {
      id: crypto.randomUUID(),
      type: "input",
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [
          {
            type: "text",
            text: [
              "Run this exact shell command and then answer with exactly the marker line:",
              `bash -lc ${JSON.stringify(script)}`,
              "Do not write files.",
            ].join("\n"),
          },
        ],
      },
    } as any

    const shell = await codexContext.react(triggerEvent, {
      env: { ...runtime.env, runtime } as any,
      runtime,
      context: { key: contextKey },
      durable: false,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
        silent: false,
      },
    })
    const result = await shell.run!

    const db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    const service = new SandboxService(db as any)

    const snapshot: any = await db.query({
      event_contexts: { $: { where: { id: result.context.id as any }, limit: 1 } },
      event_executions: { $: { where: { id: result.execution.id as any }, limit: 1 } },
      event_steps: {
        $: { where: { "execution.id": result.execution.id }, limit: 20, order: { createdAt: "asc" } },
      },
      event_items: {
        $: { where: { "context.id": result.context.id }, limit: 20, order: { createdAt: "asc" } },
      },
      sandbox_sandboxes: { $: { limit: 20, order: { createdAt: "asc" } } },
      sandbox_processes: { $: { limit: 50, order: { startedAt: "asc" } } },
    })

    const sandboxes = rows(snapshot, "sandbox_sandboxes")
    sandboxId = asString(sandboxes[0]?.id)
    const processRows = rows(snapshot, "sandbox_processes")
    const observedProcesses = processRows.filter(
      (row) => asString(row?.metadata?.source) === "codex.commandExecution",
    )
    const codexCommandProcess = observedProcesses[observedProcesses.length - 1]
    expect(codexCommandProcess).toBeTruthy()

    const stream = await service.readProcessStream(asString(codexCommandProcess.id))
    if (!stream.ok) throw new Error(stream.error)
    const stdoutText = stream.data.chunks
      .filter((chunk) => chunk.type === "stdout")
      .map((chunk) => asString(chunk.data?.text))
      .join("")
    const exitChunk = [...stream.data.chunks].reverse().find((chunk) => chunk.type === "exit")

    const report = redact({
      appId,
      marker,
      contextId: result.context.id,
      executionId: result.execution.id,
      reactionId: result.reaction.id,
      sandboxId,
      entities: {
        event_contexts: rows(snapshot, "event_contexts"),
        event_executions: rows(snapshot, "event_executions"),
        event_steps: rows(snapshot, "event_steps"),
        event_items: rows(snapshot, "event_items"),
        sandbox_sandboxes: sandboxes,
        sandbox_processes: processRows,
      },
      codexCommandProcess,
      codexCommandProcessStream: stream.data,
      derived: {
        stdoutText,
        exitChunk,
      },
    })
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `codex-sandbox-command-process-complex-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[codex-sandbox-command-process-complex] ${reportPath}`)
    console.log(
      JSON.stringify(
        {
          processId: asString(codexCommandProcess.id),
          streamClientId: asString(codexCommandProcess.streamClientId),
          command: asString(codexCommandProcess.command),
          status: asString(codexCommandProcess.status),
          stdoutText,
          chunks: stream.data.chunks.map((chunk) => ({
            seq: chunk.seq,
            type: chunk.type,
            data: chunk.data,
          })),
        },
        null,
        2,
      ),
    )

    expect(sandboxId).not.toBe("")
    expect(asString(codexCommandProcess.status)).toBe("exited")
    expect(stdoutText).toContain("complex-start")
    expect(stdoutText).toContain("alpha-line")
    expect(stdoutText).toContain("stderr-line")
    expect(stdoutText).toContain(marker)
    expect(stdoutText).toContain("complex-end")
    expect(asString(exitChunk?.data?.status)).toBe("exited")
  }, TEST_TIMEOUT_MS)
})
