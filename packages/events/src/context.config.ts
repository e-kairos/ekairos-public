import type { ContextStore } from "./context.store.js"
import type { ConcreteDomain } from "@ekairos/domain"

export type ContextEnvironment = Record<string, unknown>

export type ContextRuntime = {
  store: ContextStore
  db: any
  env?: ContextEnvironment
  domain?: ConcreteDomain<any, any>
}

const runtimeByDb = new WeakMap<object, ContextRuntime>()

export async function coerceContextRuntime(
  value: any,
  env?: ContextEnvironment,
): Promise<ContextRuntime> {
  if (!value) {
    throw new Error("Context runtime resolver returned no value.")
  }

  const resolvedEnv =
    env ??
    (typeof value === "object" && value !== null
      ? ((value as any).env as ContextEnvironment | undefined)
      : undefined)

  if (typeof value === "object" && (value as any).store) {
    return resolvedEnv ? { ...(value as ContextRuntime), env: resolvedEnv } : value as ContextRuntime
  }

  const dbCandidate =
    typeof value === "object" && value !== null && "db" in value
      ? (value as any).db
      : value

  if (!dbCandidate) {
    throw new Error("Context runtime resolver did not provide a database or store.")
  }

  if (typeof dbCandidate === "object" && dbCandidate !== null) {
    const cached = runtimeByDb.get(dbCandidate as object)
    if (cached) return resolvedEnv ? { ...cached, env: resolvedEnv } : cached
  }

  const { InstantStore } = await import("./stores/instant.store.js")
  const runtime: ContextRuntime = {
    store: new InstantStore(dbCandidate),
    db: dbCandidate,
    env: resolvedEnv,
    domain: typeof value === "object" ? (value as any).domain : undefined,
  }

  if (typeof dbCandidate === "object" && dbCandidate !== null) {
    runtimeByDb.set(dbCandidate as object, runtime)
  }

  return runtime
}
