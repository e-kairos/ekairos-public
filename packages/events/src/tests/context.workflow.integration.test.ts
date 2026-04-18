/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"

import {
  eventsDomain,
} from "../index.ts"
import { configureContextDurableWorkflow } from "../runtime.ts"
import {
  buildTriggerEvent,
  contextEngineDurableWorkflow,
  readRows,
  readString,
  storySmoke,
  storySmokeExpandedEvents,
  storySmokeScripted,
  storySmokeToolError,
} from "./workflow/context.workflow-fixtures.ts"
import {
  destroyContextTestApp,
  hasInstantProvisionToken,
  provisionContextTestApp,
} from "./_env.js"
import { EventsTestRuntime } from "./workflow/context.test-runtime.ts"

let appId: string | null = null
let adminToken: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Workflow integration DB is not initialized.")
  }
  return db
}

const describeWorkflowInstant = hasInstantProvisionToken() ? describe : describe.skip

describeWorkflowInstant("context durable workflow integration", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-workflow-vitest-${Date.now()}`,
      schema,
    })

    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
      schema,
    } as any)

    configureContextDurableWorkflow(contextEngineDurableWorkflow)
  }, 10 * 60 * 1000)

  afterAll(async () => {
    configureContextDurableWorkflow(null)
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 10 * 60 * 1000)

  async function verifyPersistedExecution(params: {
    executionId: string
    contextId: string
    expectedToolState: "output-available" | "output-error"
    expectedMode?: "success" | "tool-error" | "scripted"
  }) {
    const snapshot = await currentDb().query({
      event_executions: {
        $: { where: { id: params.executionId }, limit: 1 },
      },
      event_steps: {
        $: { where: { "execution.id": params.executionId }, limit: 50 },
      },
      event_items: {
        $: { where: { "context.id": params.contextId }, limit: 50 },
      },
    })

    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRows = readRows(snapshot, "event_steps")
    const itemRows = readRows(snapshot, "event_items")

    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toMatch(/^wrun_/)
    expect(stepRows.length).toBeGreaterThan(0)

    const firstStepId = readString(stepRows[0], "id")
    expect(firstStepId).toBeTruthy()

    const partsSnapshot = await currentDb().query({
      event_parts: {
        $: {
          where: { stepId: firstStepId as any },
          limit: 50,
          order: { idx: "asc" },
        },
      },
    })

    const partRows = readRows(partsSnapshot, "event_parts")
    const hasToolResult = partRows.some((row) => {
      const part = row.part as Record<string, unknown> | undefined
      if (!part) return false
      return (
        readString(part, "type") === "tool-result" &&
        readString(part, "toolName") === "echo" &&
        readString(part, "state") === params.expectedToolState
      )
    })
    expect(hasToolResult).toBe(true)

    if (params.expectedToolState === "output-available" && params.expectedMode) {
      const toolResultPart = partRows
        .map((row) => row.part as Record<string, unknown> | undefined)
        .find((part) => {
          if (!part) return false
          return (
            readString(part, "type") === "tool-result" &&
            readString(part, "toolName") === "echo" &&
            readString(part, "state") === "output-available"
          )
        })
      const content = Array.isArray(toolResultPart?.content) ? toolResultPart.content : []
      const jsonPart = content.find((entry) => readString(entry as Record<string, unknown>, "type") === "json") as
        | Record<string, unknown>
        | undefined
      const jsonValue = (jsonPart?.value ?? null) as Record<string, unknown> | null
      expect(readString(jsonValue ?? undefined, "mode")).toBe(params.expectedMode)
      expect(readString(jsonValue ?? undefined, "runtimeMode")).toBe(params.expectedMode)
      expect(readString(jsonValue ?? undefined, "contextId")).toBe(params.contextId)
      expect(readString(jsonValue ?? undefined, "stepId")).toBe(String(firstStepId))
      expect((jsonValue as any)?.hasDb).toBe(true)
    }

    const reactionItem = itemRows.find((row) => readString(row, "type") === "output")
    expect(readString(reactionItem, "status")).toBe("completed")
  }

  it("scripted durable react returns a run handle and persists completed state", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })
    const shell = await storySmokeScripted.react(buildTriggerEvent(), {
      runtime,
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(shell.context.id).toBeTruthy()
    expect(shell.context.status).toBe("open_streaming")
    expect(shell.reaction.status).toBe("pending")
    expect(shell.execution.status).toBe("executing")
    expect(shell.run?.runId).toMatch(/^wrun_/)

    const finalResult = await shell.run!.returnValue

    expect(finalResult.context.id).toBe(shell.context.id)
    expect(finalResult.execution.id).toBe(shell.execution.id)
    expect(finalResult.execution.status).toBe("completed")
    expect(finalResult.reaction.status).toBe("completed")

    await verifyPersistedExecution({
      executionId: shell.execution.id,
      contextId: shell.context.id,
      expectedToolState: "output-available",
      expectedMode: "scripted",
    })
  }, 10 * 60 * 1000)

  it("durable react passes expanded standard events to provider-neutral reactors", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })
    const shell = await storySmokeExpandedEvents.react(buildTriggerEvent("expand context"), {
      runtime,
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(shell.run?.runId).toMatch(/^wrun_/)

    const finalResult = await shell.run!.returnValue
    expect(finalResult.execution.status).toBe("completed")
    expect(
      JSON.stringify(finalResult.reaction.content.parts ?? []),
    ).toContain("Expanded event received.")
  }, 10 * 60 * 1000)

  it("ai sdk durable react returns a run handle and persists completed state", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "success",
    })
    const shell = await storySmoke.react(buildTriggerEvent(), {
      runtime,
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(shell.run?.runId).toMatch(/^wrun_/)

    const finalResult = await shell.run!.returnValue
    expect(finalResult.execution.status).toBe("completed")

    await verifyPersistedExecution({
      executionId: shell.execution.id,
      contextId: shell.context.id,
      expectedToolState: "output-available",
      expectedMode: "success",
    })
  }, 10 * 60 * 1000)

  it("ai sdk durable react persists tool output errors and exposes them through the run", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "tool-error",
    })
    const shell = await storySmokeToolError.react(buildTriggerEvent(), {
      runtime,
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    })

    expect(shell.run?.runId).toMatch(/^wrun_/)

    const finalResult = await shell.run!.returnValue
    expect(finalResult.execution.status).toBe("completed")

    await verifyPersistedExecution({
      executionId: shell.execution.id,
      contextId: shell.context.id,
      expectedToolState: "output-error",
    })
  }, 10 * 60 * 1000)
})
