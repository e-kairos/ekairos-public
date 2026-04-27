/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../domain/src/runtime-handle.ts"
import { configureRuntime } from "../../domain/src/runtime.ts"
import { createContext, didToolExecute, eventsDomain } from "@ekairos/events"
import { readPersistedContextStepStream } from "@ekairos/events/runtime"
import { sandboxDomain, SandboxService } from "../../sandbox/src/index.ts"
import { createCodexReactor, type CodexConfig } from "../openai-reactor/src/index.js"
import { createTestApp } from "../../ekairos-test/src/provision.ts"
import { tool } from "ai"
import { z } from "zod"
import { config as dotenvConfig } from "dotenv"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

dotenvConfig({ path: "C:/ek/.env.local", quiet: true })

const TEST_TIMEOUT_MS = 15 * 60 * 1000

const appDomain = domain("codex-sandbox-dynamic-tools-tests")
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
  runtime?: CodexSandboxToolsRuntime
}

class CodexSandboxToolsRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
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

describeReal("codex reactor sandbox dynamic tools on Vercel", () => {
  let appId = ""
  let adminToken = ""
  let runtime: CodexSandboxToolsRuntime | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `codex-sandbox-tools-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new CodexSandboxToolsRuntime({
      actorId: "codex-sandbox-tools-test-user",
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

  it("passes Context actions as Codex dynamic tools and persists canonical parts", async () => {
    if (!runtime) throw new Error("runtime_not_initialized")

    const marker = `codex-dynamic-tool-ok-${Date.now()}`
    const actionCalls: Array<Record<string, unknown>> = []
    const contextKey = `codex-sandbox-tools:${Date.now()}`
    const repoPath = "/vercel/sandbox"

    const codexContext = createContext<TestEnv>("codex.sandbox.dynamic-tools.integration")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
        workspace: repoPath,
      }))
      .narrative(() =>
        [
          "Use Codex in the remote sandbox workspace.",
          "When a tool is available and the user asks you to call it, call it before final response.",
        ].join("\n"),
      )
      .actions(() => ({
        ekairos_mark_done: tool({
          description: "Mark the current Codex sandbox integration run as completed.",
          inputSchema: z.object({
            marker: z.string(),
            note: z.string().optional(),
          }),
          execute: async (input) => {
            actionCalls.push(input)
            return {
              ok: true,
              marker: input.marker,
              finalText: marker,
            }
          },
        }),
      }))
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
              purpose: "codex-dynamic-tools-e2e",
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
              bridgePort: 4501,
              appPort: 3000,
            },
          }),
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "ekairos_mark_done"))
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
              `Call the tool ekairos_mark_done exactly once with marker "${marker}".`,
              `After the tool returns, reply with exactly "${marker}".`,
              "Do not modify files.",
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
    const dynamicCall = reactionParts.find(
      (part: any) => asString(part.type) === "tool-call" && asString(part.toolName) === "ekairos_mark_done",
    )
    const dynamicResult = reactionParts.find(
      (part: any) => asString(part.type) === "tool-result" && asString(part.toolName) === "ekairos_mark_done",
    )
    const textPart = reactionParts.find((part: any) => asString(part.type) === "content" || asString(part.type) === "text")

    const streamChunks: any[] = []
    for (const step of stepRows) {
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
      contextId: result.context.id,
      executionId: result.execution.id,
      reactionId: result.reaction.id,
      sandboxId,
      actionCalls,
      reactionParts,
      streamChunks,
      sandboxes,
      sandboxProcesses: rows(snapshot, "sandbox_processes"),
    })
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `codex-sandbox-dynamic-tools-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[codex-sandbox-dynamic-tools] ${reportPath}`)

    expect(sandboxId).not.toBe("")
    expect(actionCalls).toHaveLength(1)
    expect(asString(actionCalls[0]?.marker)).toBe(marker)
    expect(dynamicCall).toBeTruthy()
    expect(dynamicResult).toBeTruthy()
    expect(asString(dynamicResult?.state)).toBe("output-available")
    expect(JSON.stringify(dynamicResult)).toContain(marker)
    expect(JSON.stringify(textPart)).toContain(marker)
    expect(
      streamChunks.some((chunk) => asString(chunk.providerChunkType) === "item/tool/call"),
    ).toBe(true)
    expect(
      streamChunks.some((chunk) => asString(chunk.providerChunkType) === "item/tool/result"),
    ).toBe(true)
  }, TEST_TIMEOUT_MS)
})
