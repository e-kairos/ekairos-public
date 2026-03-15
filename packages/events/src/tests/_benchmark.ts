import { mkdirSync, writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { resolve } from "node:path"

function roundMs(value: number) {
  return Math.max(0, Math.round(value))
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

export function writeBenchmarkReport(name: string, payload: Record<string, unknown>) {
  const reportDir = resolve(process.cwd(), ".ekairos", "reports")
  mkdirSync(reportDir, { recursive: true })
  const reportPath = resolve(reportDir, `${name}-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  // eslint-disable-next-line no-console
  console.log(`[context-benchmark-report] ${reportPath}`)
}
