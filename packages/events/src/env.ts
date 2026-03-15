import type { ContextEnvironment } from "./context.config.js"

const envByRunIdSymbol = Symbol.for("ekairos.context.envByRunId")
const defaultEnvSymbol = Symbol.for("ekairos.context.defaultEnv")

type EnvMap = Map<string, ContextEnvironment>

function getEnvMap(): EnvMap {
  if (typeof globalThis === "undefined") return new Map<string, ContextEnvironment>()
  const existing = (globalThis as any)[envByRunIdSymbol]
  if (existing) return existing as EnvMap
  const created = new Map<string, ContextEnvironment>()
  ;(globalThis as any)[envByRunIdSymbol] = created
  return created
}

function setDefaultEnv(env: ContextEnvironment | null) {
  if (typeof globalThis === "undefined") return
  ;(globalThis as any)[defaultEnvSymbol] = env ?? null
}

function getDefaultEnv(): ContextEnvironment | null {
  if (typeof globalThis === "undefined") return null
  return (globalThis as any)[defaultEnvSymbol] ?? null
}

export function registerContextEnv(env: ContextEnvironment, runId?: string | null) {
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

export async function getContextEnv(): Promise<ContextEnvironment> {
  const runId = await tryGetWorkflowRunId()
  if (runId) {
    const stored = getEnvMap().get(runId)
    if (stored) return stored
  }
  const fallback = getDefaultEnv()
  if (fallback) return fallback
  throw new Error(
    "@ekairos/events: env is not configured for this workflow run. " +
      "Call registerContextEnv(env) at workflow start or ensure the context runtime registers env.",
  )
}
