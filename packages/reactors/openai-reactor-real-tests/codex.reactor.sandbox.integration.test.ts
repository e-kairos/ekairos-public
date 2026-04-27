/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../domain/src/runtime-handle.ts"
import { configureRuntime } from "../../domain/src/runtime.ts"
import { createContext, eventsDomain } from "@ekairos/events"
import { sandboxDomain, SandboxService } from "../../sandbox/src/index.ts"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { createCodexReactor, type CodexConfig } from "../openai-reactor/src/index.js"
import {
  createTestApp,
  destroyTestApp,
} from "../../ekairos-test/src/provision.ts"

const execFileAsync = promisify(execFile)
const TEST_TIMEOUT_MS = 20 * 60 * 1000

const appDomain = domain("codex-sandbox-reactor-tests")
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
}

type TestContext = {
  actorId?: string
  workspace?: string
}

class CodexSandboxRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
  static [WORKFLOW_SERIALIZE](instance: CodexSandboxRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: TestEnv }) {
    return this.deserializeRuntime(data) as CodexSandboxRuntime
  }

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

function readPartOutput(result: any) {
  const content = result?.reaction?.content ?? {}
  const parts = Array.isArray(content.parts) ? content.parts : []
  const metadata = parts.find(
    (part: any) =>
      String(part?.type ?? "") === "tool-turnMetadata" ||
      (String(part?.type ?? "") === "tool-result" && String(part?.toolName ?? "") === "turnMetadata") ||
      part?.output?.sandbox ||
      part?.output?.providerContextId,
  )
  return metadata?.output ?? metadata?.content?.find((entry: any) => entry?.type === "json")?.value ?? {}
}

async function runPublishedCli(args: string[]) {
  const isWindows = process.platform === "win32"
  const command = isWindows ? "cmd.exe" : "npx"
  const commandArgs = isWindows
    ? ["/c", "npx", "-y", "@ekairos/domain@beta", ...args]
    : ["-y", "@ekairos/domain@beta", ...args]
  const { stdout, stderr } = await execFileAsync(command, commandArgs, {
    timeout: 2 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 10,
    windowsHide: true,
  })
  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
}

function parseJsonOutput(stdout: string) {
  const trimmed = String(stdout ?? "").trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`cli_json_missing:${trimmed.slice(0, 300)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

const describeReal = hasRealSandboxEnv() ? describe : describe.skip

describeReal("codex reactor on Vercel sandbox", () => {
  let appId = ""
  let adminToken = ""
  let runtime: CodexSandboxRuntime | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `codex-reactor-sandbox-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new CodexSandboxRuntime({
      actorId: "codex-sandbox-reactor-test-user",
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
    if (sandboxId && appId && adminToken && process.env.APP_TEST_PERSIST !== "true") {
      const db = init({
        appId,
        adminToken,
        schema: appDomain.toInstantSchema(),
        useDateObjects: true,
      } as any)
      await new SandboxService(db as any).stopSandbox(sandboxId).catch(() => {})
    }
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({ appId, token: getInstantProvisionToken() }).catch(() => {})
    }
  }, 5 * 60 * 1000)

  it("creates and starts an Ekairos app, runs Codex against it, and verifies the public domain URL with the beta CLI", async () => {
    if (!runtime) throw new Error("runtime_not_initialized")
    const contextKey = `codex-sandbox-reactor:${Date.now()}`
    const repoPath = "/vercel/sandbox/ekairos-app"

    const codexContext = createContext<TestEnv>("codex.sandbox.reactor.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: repoPath,
      }))
      .narrative(() => "Use Codex in the remote sandbox workspace.")
      .actions(() => ({}))
      .reactor(
        createCodexReactor<TestContext, CodexConfig, TestEnv>({
          includeReasoningPart: true,
          includeStreamTraceInOutput: true,
          includeRawProviderChunksInOutput: false,
          resolveConfig: async ({ env }) => ({
            mode: "sandbox",
            appServerUrl: "sandbox://internal",
            repoPath,
            approvalPolicy: "never",
            sandbox: {
              provider: "vercel",
              runtime: "node22",
              purpose: "codex-reactor-sandbox-integration",
              vercel: {},
              authJsonPath: env.authJsonPath,
              configTomlPath: env.configTomlPath,
              createApp: true,
              installApp: true,
              startApp: true,
              checkpoint: true,
              bridgePort: 4500,
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
            text: "Create CODEX_REACTOR_SANDBOX_PROOF.txt containing exactly codex-reactor-sandbox-ok. Do not modify any other file.",
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

    const output = readPartOutput(result)
    const sandbox = output.sandbox ?? {}
    sandboxId = String(sandbox.sandboxId ?? "")
    const appBaseUrl = String(sandbox.appBaseUrl ?? "")
    expect(sandboxId).not.toBe("")
    expect(appBaseUrl).toMatch(/^https?:\/\//)
    expect(String(output.providerContextId ?? "")).not.toBe("")
    expect(String(output.turnId ?? "")).not.toBe("")
    expect(Array.isArray(sandbox.checkpoints)).toBe(true)

    const db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    const service = new SandboxService(db as any)
    const proof = await service.readFile(sandboxId, `${repoPath}/CODEX_REACTOR_SANDBOX_PROOF.txt`)
    if (!proof.ok) throw new Error(proof.error)
    expect(Buffer.from(proof.data.contentBase64, "base64").toString("utf8")).toBe("codex-reactor-sandbox-ok")

    const inspect = parseJsonOutput((await runPublishedCli(["inspect", `--baseUrl=${appBaseUrl}`, "--admin", "--pretty"])).stdout)
    expect(inspect.ok).toBe(true)

    const seed = parseJsonOutput((await runPublishedCli(["seedDemo", "{}", `--baseUrl=${appBaseUrl}`, "--admin", "--pretty"])).stdout)
    expect(seed.ok).toBe(true)

    const query = parseJsonOutput(
      (await runPublishedCli([
        "query",
        "{ app_tasks: { comments: {} } }",
        `--baseUrl=${appBaseUrl}`,
        "--admin",
        "--meta",
        "--pretty",
      ])).stdout,
    )
    expect(query.ok).toBe(true)
    expect(Array.isArray(query.data?.app_tasks)).toBe(true)
    expect(query.data.app_tasks.length).toBeGreaterThan(0)
  }, TEST_TIMEOUT_MS)
})
