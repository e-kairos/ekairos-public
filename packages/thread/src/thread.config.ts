import type { ThreadStore } from "./thread.store.js"
import type { ConcreteDomain } from "@ekairos/domain";

/**
 * ## thread.config.ts
 *
 * Thread runtime is resolved from the app runtime configured in `@ekairos/domain/runtime`.
 * There is no thread-specific runtime configuration surface.
 */

export type ThreadEnvironment = Record<string, unknown>

export type ThreadRuntime = {
  store: ThreadStore
  db: any
  domain?: ConcreteDomain<any, any>
}

const runtimeByDb = new WeakMap<object, ThreadRuntime>()

export async function coerceThreadRuntime(value: any): Promise<ThreadRuntime> {
  if (!value) {
    throw new Error("Thread runtime resolver returned no value.")
  }

  if (typeof value === "object" && (value as any).store) {
    return value as ThreadRuntime
  }

  const dbCandidate =
    typeof value === "object" && value !== null && "db" in value
      ? (value as any).db
      : value

  if (!dbCandidate) {
    throw new Error("Thread runtime resolver did not provide a database or store.")
  }

  if (typeof dbCandidate === "object" && dbCandidate !== null) {
    const cached = runtimeByDb.get(dbCandidate as object)
    if (cached) return cached
  }

  const { InstantStore } = await import("./stores/instant.store.js")
  const runtime: ThreadRuntime = {
    store: new InstantStore(dbCandidate),
    db: dbCandidate,
    domain: typeof value === "object" ? (value as any).domain : undefined,
  }

  if (typeof dbCandidate === "object" && dbCandidate !== null) {
    runtimeByDb.set(dbCandidate as object, runtime)
  }

  return runtime
}



