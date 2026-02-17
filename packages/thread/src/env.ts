import type { ThreadEnvironment } from "./thread.config.js"

const envByRunIdSymbol = Symbol.for("ekairos.thread.envByRunId")
const defaultEnvSymbol = Symbol.for("ekairos.thread.defaultEnv")

type EnvMap = Map<string, ThreadEnvironment>

function getEnvMap(): EnvMap {
  if (typeof globalThis === "undefined") return new Map<string, ThreadEnvironment>()
  const existing = (globalThis as any)[envByRunIdSymbol]
  if (existing) return existing as EnvMap
  const created = new Map<string, ThreadEnvironment>()
  ;(globalThis as any)[envByRunIdSymbol] = created
  return created
}

function setDefaultEnv(env: ThreadEnvironment | null) {
  if (typeof globalThis === "undefined") return
  ;(globalThis as any)[defaultEnvSymbol] = env ?? null
}

function getDefaultEnv(): ThreadEnvironment | null {
  if (typeof globalThis === "undefined") return null
  return (globalThis as any)[defaultEnvSymbol] ?? null
}

/**
 * Register the current workflow env for later use inside "use step" functions.
 *
 * If runId is provided, it will be stored under that run. If not, a default env is set.
 */
export function registerThreadEnv(env: ThreadEnvironment, runId?: string | null) {
  if (runId) {
    getEnvMap().set(String(runId), env)
    return
  }
  setDefaultEnv(env)
}

async function tryGetWorkflowRunId(): Promise<string | null> {
  try {
    const mod = await import("workflow")
    const meta = mod?.getWorkflowMetadata?.()
    const runId = meta?.workflowRunId
    return runId ? String(runId) : null
  } catch {
    return null
  }
}

/**
 * Resolve the env for the current workflow/step.
 * Falls back to the default env if no run-specific env exists.
 */
export async function getThreadEnv(): Promise<ThreadEnvironment> {
  const runId = await tryGetWorkflowRunId()
  if (runId) {
    const stored = getEnvMap().get(runId)
    if (stored) return stored
  }
  const fallback = getDefaultEnv()
  if (fallback) return fallback
  throw new Error(
    "@ekairos/thread: env is not configured for this workflow run. " +
      "Call registerThreadEnv(env) at workflow start or ensure the thread runtime registers env.",
  )
}
