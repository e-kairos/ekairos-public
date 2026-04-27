/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../domain/src/runtime-handle.ts"
import { configureRuntime } from "../../domain/src/runtime.ts"
import { createContext, eventsDomain } from "@ekairos/events"
import { readPersistedContextStepStream } from "@ekairos/events/runtime"
import { sandboxDomain, SandboxService } from "../../sandbox/src/index.ts"
import { createCodexReactor, type CodexConfig } from "../openai-reactor/src/index.js"
import { createTestApp } from "../../ekairos-test/src/provision.ts"
import { config as dotenvConfig } from "dotenv"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

dotenvConfig({ path: "C:/ek/.env.local", quiet: true })

const TEST_TIMEOUT_MS = 15 * 60 * 1000

const appDomain = domain("codex-sandbox-narrative-tests")
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
  runtime?: CodexSandboxNarrativeRuntime
}

class CodexSandboxNarrativeRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
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

describeReal("codex reactor sandbox narrative on Vercel", () => {
  let appId = ""
  let adminToken = ""
  let runtime: CodexSandboxNarrativeRuntime | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `codex-sandbox-narrative-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new CodexSandboxNarrativeRuntime({
      actorId: "codex-sandbox-narrative-test-user",
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

  it("passes narrative as Codex baseInstructions and persists the resulting events", async () => {
    if (!runtime) throw new Error("runtime_not_initialized")

    const marker = `narrative-marker-${Date.now()}`
    const contextKey = `codex-sandbox-narrative:${Date.now()}`
    const repoPath = "/vercel/sandbox"

    const codexContext = createContext<TestEnv>("codex.sandbox.narrative.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: repoPath,
      }))
      .narrative(() =>
        [
          "You are Codex running inside an Ekairos Vercel sandbox.",
          `Narrative secret marker: ${marker}`,
          "If the user asks for the narrative marker, answer with exactly the marker.",
        ].join("\n"),
      )
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
              purpose: "codex-narrative-e2e",
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
              bridgePort: 4502,
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
            text: "Return the narrative marker exactly. Do not inspect files and do not run shell commands.",
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
    const stepRows = rows(snapshot, "event_steps")
    const reactionItem = rows(snapshot, "event_items").find((item) => asString(item.id) === result.reaction.id)
    const reactionParts = Array.isArray(reactionItem?.content?.parts) ? reactionItem.content.parts : []
    const textPart = reactionParts.find((part: any) => asString(part.type) === "content" || asString(part.type) === "text")

    const eventParts: any[] = []
    const streamChunks: any[] = []
    for (const step of stepRows) {
      const stepId = asString(step.id)
      if (stepId) {
        const partsSnapshot: any = await db.query({
          event_parts: { $: { where: { stepId }, limit: 100, order: { idx: "asc" } } },
        })
        eventParts.push(...rows(partsSnapshot, "event_parts"))
      }
      const streamClientId = asString(step.streamClientId)
      const streamId = asString(step.streamId)
      if (!streamClientId && !streamId) continue
      const persisted = await readPersistedContextStepStream({
        db,
        clientId: streamClientId || undefined,
        streamId: streamId || undefined,
      })
      streamChunks.push(...persisted.chunks)
    }

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
        event_steps: stepRows,
        event_items: rows(snapshot, "event_items"),
        event_parts: eventParts,
        sandbox_sandboxes: sandboxes,
        sandbox_processes: rows(snapshot, "sandbox_processes"),
      },
      streams: {
        context_step_chunks: streamChunks,
      },
      derived: {
        reactionParts,
        textPart,
      },
    })
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `codex-sandbox-narrative-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[codex-sandbox-narrative] ${reportPath}`)

    expect(sandboxId).not.toBe("")
    expect(JSON.stringify(textPart)).toContain(marker)
    expect(eventParts.length).toBeGreaterThan(0)
    expect(stepRows.length).toBe(1)
    expect(streamChunks.some((chunk) => asString(chunk.providerChunkType) === "turn/completed")).toBe(true)
  }, TEST_TIMEOUT_MS)
})
