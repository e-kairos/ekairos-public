import { mkdirSync, writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { resolve } from "node:path"

function roundMs(value: number) {
  return Math.max(0, Math.round(value))
}

function readMs(stageTimingsMs: Record<string, number>, name: string) {
  return roundMs(Number(stageTimingsMs[name] ?? 0) || 0)
}

function isWallStage(name: string) {
  return (
    !name.startsWith("react.network.") &&
    !name.endsWith(".networkMs") &&
    !name.endsWith("Count")
  )
}

function sumWallStages(
  stageTimingsMs: Record<string, number>,
  predicate: (name: string) => boolean,
) {
  return roundMs(
    Object.entries(stageTimingsMs).reduce((total, [name, value]) => {
      if (!isWallStage(name) || !predicate(name)) return total
      return total + (Number(value) || 0)
    }, 0),
  )
}

function toDateMs(value: unknown) {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

function diffMs(start: unknown, end: unknown) {
  const startMs = toDateMs(start)
  const endMs = toDateMs(end)
  if (startMs === null || endMs === null) return null
  return roundMs(endMs - startMs)
}

function toIso(value: unknown) {
  const ms = toDateMs(value)
  return ms === null ? null : new Date(ms).toISOString()
}

export function createStageTimer() {
  const startedAt = performance.now()
  const stageTimingsMs: Record<string, number> = {}
  let currentStage: string | undefined

  return {
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const previousStage = currentStage
      currentStage = name
      const stageStartedAt = performance.now()
      try {
        return await run()
      } finally {
        stageTimingsMs[name] = roundMs(performance.now() - stageStartedAt)
        currentStage = previousStage
      }
    },
    add(name: string, value: number) {
      stageTimingsMs[name] = roundMs((stageTimingsMs[name] ?? 0) + value)
    },
    getCurrentStage() {
      return currentStage
    },
    snapshot() {
      return {
        totalMs: roundMs(performance.now() - startedAt),
        stageTimingsMs: { ...stageTimingsMs },
      }
    },
  }
}

export function summarizeContextBenchmarkComponents(stageTimingsMs: Record<string, number>) {
  return {
    shellMs: readMs(stageTimingsMs, "reactShellMs"),
    runAwaitMs: readMs(stageTimingsMs, "reactRunMs"),
    verificationMs:
      readMs(stageTimingsMs, "snapshotQueryMs") +
      readMs(stageTimingsMs, "verifyPersistedExecutionMs"),
    instantDbMs: readMs(stageTimingsMs, "react.network.totalMs"),
    instantDbQueryMs: readMs(stageTimingsMs, "react.network.queryMs"),
    instantDbTransactMs: readMs(stageTimingsMs, "react.network.transactMs"),
    contextPersistenceMs: sumWallStages(stageTimingsMs, (name) =>
      /(^react\.initializeContextMs$|^react\.bootstrapShellMs$|^react\.bootstrapContextLookupMs$|\.createStepMs$|\.openReactionStepMs$|\.persistContextMs$|\.loadEventsMs$|\.saveStepPartsMs$|\.appendReactorOutputMs$|\.persistAssistantReactionMs$|\.markStepRunningMs$|\.saveFinalStepPartsMs$|\.completeStepMs$|\.finalizeReactionStepMs$|\.completeReactionMs$|\.completeExecutionMs$|^react\.durable\.persistWorkflowRunIdMs$)/.test(
        name,
      ),
    ),
    contextDslMs: sumWallStages(stageTimingsMs, (name) =>
      /(\.contextMs$|\.narrativeMs$|\.actionsMs$|\.skillsMs$|\.expandEventsMs$|\.shouldContinueMs$)/.test(
        name,
      ),
    ),
    reactorMs: sumWallStages(stageTimingsMs, (name) => /\.reactorMs$/.test(name)),
    actionExecutionMs: sumWallStages(stageTimingsMs, (name) =>
      /\.actionExecutionMs$/.test(name),
    ),
    workflowApiImportMs: readMs(stageTimingsMs, "react.durable.importWorkflowApiMs"),
    workflowStartMs: readMs(stageTimingsMs, "react.durable.startWorkflowMs"),
    workflowRunIdPersistMs: readMs(stageTimingsMs, "react.durable.persistWorkflowRunIdMs"),
  }
}

export function summarizeInstantDbCounts(stageTimingsMs: Record<string, number>) {
  return {
    queryCount: readMs(stageTimingsMs, "react.network.queryCount"),
    transactCount: readMs(stageTimingsMs, "react.network.transactCount"),
  }
}

export async function readWorkflowBenchmarkSnapshot(runId: string) {
  const { getWorld } = await import("workflow/runtime")
  const world = await getWorld()
  const run = await world.runs.get(runId, { resolveData: "none" } as any)
  const steps: any[] = []
  let cursor: string | undefined

  do {
    const page = await world.steps.list({
      runId,
      resolveData: "none",
      pagination: {
        cursor,
        limit: 100,
        sortOrder: "asc",
      },
    } as any)
    steps.push(...((page as any).data ?? []))
    cursor = (page as any).cursor ?? undefined
    if (!(page as any).hasMore) break
  } while (cursor)

  const stepRows = steps.map((step) => {
    const runMs = diffMs(step.startedAt, step.completedAt) ?? 0
    const queueMs = diffMs(step.createdAt, step.startedAt) ?? 0
    return {
      stepId: String(step.stepId ?? ""),
      name: String(step.stepName ?? ""),
      status: String(step.status ?? ""),
      runMs,
      queueMs,
      createdAt: toIso(step.createdAt),
      startedAt: toIso(step.startedAt),
      completedAt: toIso(step.completedAt),
    }
  })

  const byName: Record<string, { count: number; runMs: number; queueMs: number }> = {}
  for (const step of stepRows) {
    const name = step.name || "(unknown)"
    const current = byName[name] ?? { count: 0, runMs: 0, queueMs: 0 }
    current.count += 1
    current.runMs = roundMs(current.runMs + step.runMs)
    current.queueMs = roundMs(current.queueMs + step.queueMs)
    byName[name] = current
  }

  const workflowExecutionMs = diffMs((run as any).startedAt, (run as any).completedAt) ?? 0
  const workflowStepRunMs = roundMs(stepRows.reduce((total, step) => total + step.runMs, 0))

  return {
    run: {
      runId,
      status: String((run as any).status ?? ""),
      createdAt: toIso((run as any).createdAt),
      startedAt: toIso((run as any).startedAt),
      completedAt: toIso((run as any).completedAt),
      queueMs: diffMs((run as any).createdAt, (run as any).startedAt),
      executionMs: workflowExecutionMs,
      lifecycleMs: diffMs((run as any).createdAt, (run as any).completedAt),
      nonStepWorkflowMs: roundMs(Math.max(0, workflowExecutionMs - workflowStepRunMs)),
    },
    steps: {
      count: stepRows.length,
      totalRunMs: workflowStepRunMs,
      totalQueueMs: roundMs(stepRows.reduce((total, step) => total + step.queueMs, 0)),
      byName,
      slowest: [...stepRows].sort((a, b) => b.runMs - a.runMs).slice(0, 10),
    },
  }
}

export function writeBenchmarkReport(name: string, payload: Record<string, unknown>) {
  const reportDir = resolve(process.cwd(), ".ekairos", "reports")
  mkdirSync(reportDir, { recursive: true })
  const reportPath = resolve(reportDir, `${name}-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  // eslint-disable-next-line no-console
  console.log(`[context-benchmark-report] ${reportPath}`)
}
