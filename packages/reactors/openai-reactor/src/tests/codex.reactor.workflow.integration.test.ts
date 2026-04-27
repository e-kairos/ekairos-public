/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import http from "node:http"
import { eventsDomain } from "@ekairos/events"
import { configureContextDurableWorkflow } from "@ekairos/events/runtime"
import { Sandbox } from "@ekairos/sandbox/sandbox"

import {
  ASSISTANT_TEXT,
  PROVIDER_CONTEXT_ID,
  TURN_ID,
  buildTriggerEvent,
  buildCodexAppServerNotifications,
  CodexWorkflowTestRuntime,
  codexReactorDurableWorkflow,
  codexWorkflowContext,
} from "./codex.reactor.workflow-fixtures.js"
import { verifyEventDomainRun } from "../../../../events/src/tests/context.reactor-contract.js"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return ""
}

function getInstantProvisionToken() {
  const raw = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function hasInstantProvisionToken(): boolean {
  return Boolean(getInstantProvisionToken())
}

async function provisionContextTestApp(params: { name: string; schema: unknown }) {
  const token = getInstantProvisionToken()
  if (!token) {
    throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN is required for Codex workflow tests.")
  }
  const { createTestApp } = await import("../../../../ekairos-test/src/provision.ts")
  return await createTestApp({
    name: params.name,
    token,
    schema: params.schema as any,
  })
}

async function destroyContextTestApp(appId: string): Promise<void> {
  const token = getInstantProvisionToken()
  if (!token || !appId) return
  const { destroyTestApp } = await import("../../../../ekairos-test/src/provision.ts")
  await destroyTestApp({ appId, token })
}

let appId: string | null = null
let adminToken: string | null = null
let db: ReturnType<typeof init> | null = null
let mockServer: http.Server | null = null
let mockAppServerUrl = ""

function currentDb() {
  if (!db) throw new Error("Codex workflow test DB is not initialized.")
  return db
}

const describeWorkflowInstant = hasInstantProvisionToken() ? describe : describe.skip

async function startMockCodexTurnServer(): Promise<string> {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/turn") {
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "not_found" }))
      return
    }

    let body = ""
    request.on("data", (chunk) => {
      body += chunk.toString()
    })
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          providerContextId: PROVIDER_CONTEXT_ID,
          turnId: TURN_ID,
          assistantText: ASSISTANT_TEXT,
          reasoningText: "",
          diff: "",
          usage: {
            inputTokens: 42,
            outputTokens: 11,
            totalTokens: 53,
          },
          stream: buildCodexAppServerNotifications(),
          request: body ? JSON.parse(body) : null,
        }),
      )
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  mockServer = server
  const address = server.address()
  if (!address || typeof address !== "object") {
    throw new Error("mock_codex_server_address_unavailable")
  }
  return `http://127.0.0.1:${address.port}/turn`
}

describeWorkflowInstant("codex reactor + durable context engine workflow", () => {
  beforeAll(async () => {
    mockAppServerUrl = await startMockCodexTurnServer()
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `codex-reactor-workflow-${Date.now()}`,
      schema,
    })

    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
      schema,
      useDateObjects: true,
    } as any)

    configureContextDurableWorkflow(codexReactorDurableWorkflow)
  }, 10 * 60 * 1000)

  afterAll(async () => {
    configureContextDurableWorkflow(null)
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer?.close(() => resolve())
      })
      mockServer = null
    }
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 10 * 60 * 1000)

  it("runs Codex reactor through durable ContextEngine and persists parts plus step stream", async () => {
    const runtime = new CodexWorkflowTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      appServerUrl: mockAppServerUrl,
      repoPath: "/workspace/repo",
      providerContextId: PROVIDER_CONTEXT_ID,
      model: "codex-test",
      approvalPolicy: "never",
    })

    const shell = await codexWorkflowContext.react(buildTriggerEvent(), {
      runtime,
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(shell.context.status).toBe("open_streaming")
    expect(shell.reaction.status).toBe("pending")
    expect(shell.execution.status).toBe("executing")
    expect(shell.run?.runId).toMatch(/^wrun_/)

    const finalResult = await shell.run!.returnValue
    expect(finalResult.context.id).toBe(shell.context.id)
    expect(finalResult.execution.id).toBe(shell.execution.id)
    expect(finalResult.execution.status).toBe("completed")
    expect(finalResult.reaction.status).toBe("completed")

    const eventDomain = await verifyEventDomainRun({
      db: currentDb(),
      contextId: shell.context.id,
      executionId: shell.execution.id,
      triggerEventId: shell.trigger.id,
      reactionEventId: finalResult.reaction.id,
      durable: true,
      requireStepStream: true,
    })

    const parts = eventDomain.parts.map((part) => asRecord(part))
    const partTypes = parts.map((part) => asString(part.type))

    expect(partTypes).toContain("message")
    expect(partTypes).toContain("action")
    expect(partTypes).not.toContain("codex-event")

    const textPart = parts.find((part) => {
      if (asString(part.type) !== "message") return false
      const content = asRecord(part.content)
      return asString(content.text) === ASSISTANT_TEXT
    })
    expect(textPart).toBeTruthy()

    const commandCallPart = parts.find(
      (part) =>
        asString(part.type) === "action" &&
        asString(asRecord(part.content).status) === "started" &&
        asString(asRecord(part.content).actionName) === Sandbox.runCommandActionName,
    )
    expect(commandCallPart).toBeTruthy()
    const commandCallJson = asRecord(asRecord(commandCallPart?.content).input)
    expect(asString(commandCallJson.command)).toBe("git status --short")

    const commandResultPart = parts.find(
      (part) =>
        asString(part.type) === "action" &&
        asString(asRecord(part.content).status) === "completed" &&
        asString(asRecord(part.content).actionName) === Sandbox.runCommandActionName,
    )
    const commandResultJson = asRecord(asRecord(commandResultPart?.content).output)
    expect(commandResultJson.success).toBe(true)
    expect(asString(commandResultJson.output)).toBe("clean")

    const metadataPart = parts.find(
      (part) =>
        asString(part.type) === "action" &&
        asString(asRecord(part.content).status) === "completed" &&
        asString(asRecord(part.content).actionName) === "turnMetadata",
    )
    const metadataOutput = asRecord(asRecord(metadataPart?.content).output)
    expect(asString(metadataOutput.providerContextId)).toBe(PROVIDER_CONTEXT_ID)
    expect(asString(metadataOutput.turnId)).toBe(TURN_ID)
    expect(asRecord(metadataOutput.tokenUsage).totalTokens).toBe(53)

    const streamChunkTypes = eventDomain.streamChunks.map((chunk) => chunk.chunkType)
    expect(streamChunkTypes).toContain("chunk.start")
    expect(streamChunkTypes).toContain("chunk.text_delta")
    expect(streamChunkTypes).toContain("chunk.text_end")
    expect(streamChunkTypes).toContain("chunk.action_input_available")
    expect(streamChunkTypes).toContain("chunk.action_output_available")
    expect(streamChunkTypes).toContain("chunk.finish")
  }, 10 * 60 * 1000)
})
