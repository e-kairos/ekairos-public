/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"

import {
  eventsDomain,
} from "../index.ts"
import { configureContextDurableWorkflow } from "../runtime.ts"
import {
  asRecord,
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
import {
  createStageTimer,
  readWorkflowBenchmarkSnapshot,
  summarizeContextBenchmarkComponents,
  summarizeInstantDbCounts,
  writeBenchmarkReport,
} from "./_benchmark.ts"
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

function findPersistedActionPart(
  partRows: Record<string, unknown>[],
  actionName: string,
  expectedToolState: "output-available" | "output-error",
): Record<string, unknown> | null {
  const expectedStatus = expectedToolState === "output-available" ? "completed" : "failed"

  for (const row of partRows) {
    const part = asRecord(row.part)
    if (!part) continue

    const content = asRecord(part.content)
    if (
      part.type === "action" &&
      content?.status === expectedStatus &&
      content?.actionName === actionName
    ) {
      return part
    }

    if (
      readString(part, "type") === "tool-result" &&
      readString(part, "toolName") === actionName &&
      readString(part, "state") === expectedToolState
    ) {
      return part
    }
  }

  return null
}

function readPersistedActionOutput(
  part: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!part) return null
  if (part.type === "action") {
    return asRecord(asRecord(part.content)?.output)
  }

  const output = asRecord(part.output)
  if (output) return output

  if (Array.isArray(part.content)) {
    return {
      type: "content",
      value: part.content,
    }
  }

  return null
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
    const toolResultPart = findPersistedActionPart(partRows, "echo", params.expectedToolState)
    expect(toolResultPart).toBeTruthy()

    if (params.expectedToolState === "output-available" && params.expectedMode) {
      const toolOutput = readPersistedActionOutput(toolResultPart)
      const content = Array.isArray(toolOutput?.value) ? toolOutput.value : []
      const jsonPart = content.find((entry) => readString(entry as Record<string, unknown>, "type") === "json") as
        | Record<string, unknown>
        | undefined
      const jsonValue = (jsonPart?.value ?? toolOutput?.value ?? null) as Record<string, unknown> | null
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
    const timer = createStageTimer()
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })
    const shell = await timer.measure("reactShellMs", async () =>
      await storySmokeScripted.react(buildTriggerEvent(), {
        runtime,
        context: null,
        __benchmark: timer,
        options: {
          maxIterations: 1,
          maxModelSteps: 1,
        },
      }),
    )

    expect(shell.context.id).toBeTruthy()
    expect(shell.context.status).toBe("open_streaming")
    expect(shell.reaction.status).toBe("pending")
    expect(shell.execution.status).toBe("executing")
    expect(shell.run?.runId).toMatch(/^wrun_/)

    const runAwaitStartedAt = Date.now()
    const finalResult = await timer.measure(
      "reactRunMs",
      async () => await shell.run!.returnValue,
    )
    const runAwaitEndedAt = Date.now()

    expect(finalResult.context.id).toBe(shell.context.id)
    expect(finalResult.execution.id).toBe(shell.execution.id)
    expect(finalResult.execution.status).toBe("completed")
    expect(finalResult.reaction.status).toBe("completed")

    const workflowSnapshot = await timer.measure(
      "readWorkflowSnapshotMs",
      async () => await readWorkflowBenchmarkSnapshot(shell.run!.runId),
    )

    await timer.measure(
      "verifyPersistedExecutionMs",
      async () =>
        await verifyPersistedExecution({
          executionId: shell.execution.id,
          contextId: shell.context.id,
          expectedToolState: "output-available",
          expectedMode: "scripted",
        }),
    )

    const timings = timer.snapshot()
    const workflowCompletedAtMs = workflowSnapshot.run.completedAt
      ? Date.parse(workflowSnapshot.run.completedAt)
      : null
    writeBenchmarkReport("context-scripted-durable-report", {
      test: "context durable workflow integration > scripted durable react returns a run handle and persists completed state",
      mode: "durable",
      totalMs: timings.totalMs,
      componentTimingsMs: {
        totalWallMs: timings.totalMs,
        ...summarizeContextBenchmarkComponents(timings.stageTimingsMs),
        workflowQueueMs: workflowSnapshot.run.queueMs,
        workflowExecutionMs: workflowSnapshot.run.executionMs,
        workflowLifecycleMs: workflowSnapshot.run.lifecycleMs,
        workflowStepRunMs: workflowSnapshot.steps.totalRunMs,
        workflowStepQueueMs: workflowSnapshot.steps.totalQueueMs,
        workflowNonStepMs: workflowSnapshot.run.nonStepWorkflowMs,
        workflowReturnValueResolveLagMs:
          workflowCompletedAtMs && Number.isFinite(workflowCompletedAtMs)
            ? Math.max(0, runAwaitEndedAt - workflowCompletedAtMs)
            : null,
      },
      instantDbCounts: summarizeInstantDbCounts(timings.stageTimingsMs),
      workflowTimings: workflowSnapshot,
      runAwaitWindow: {
        startedAt: new Date(runAwaitStartedAt).toISOString(),
        endedAt: new Date(runAwaitEndedAt).toISOString(),
        observedMs: runAwaitEndedAt - runAwaitStartedAt,
      },
      stageTimingsMs: timings.stageTimingsMs,
      workflowRunId: shell.run!.runId,
      contextId: finalResult.context.id,
      executionId: finalResult.execution.id,
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
