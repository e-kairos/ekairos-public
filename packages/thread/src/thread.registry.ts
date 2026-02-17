import type { ThreadEnvironment } from "./thread.config.js"
import type { ThreadInstance } from "./thread.builder.js"

/**
 * Global registry for threads, similar to Inngest's function registry.
 *
 * Goals:
 * - `createThread("key")` can be called many times (module reloads, tests, etc.)
 * - Execution resolves a thread by key (`getThread("key")`) instead of importing the module directly.
 * - Registration is intentionally **runtime-local** (per process / per serverless instance).
 */

export type ThreadKey = string

type AnyThread = ThreadInstance<any, any>

export type ThreadFactory = () => AnyThread

const registry = new Map<ThreadKey, ThreadFactory>()

export function registerThread(key: ThreadKey, factory: ThreadFactory) {
  if (!key || typeof key !== "string") {
    throw new Error("registerThread: key must be a non-empty string")
  }
  if (typeof factory !== "function") {
    throw new Error("registerThread: factory must be a function")
  }
  registry.set(key, factory)
}

export function hasThread(key: ThreadKey) {
  return registry.has(key)
}

export function getThread<Env extends ThreadEnvironment = ThreadEnvironment>(key: ThreadKey) {
  const factory = registry.get(key)
  if (!factory) {
    throw new Error(
      `Thread "${key}" is not registered. Ensure the module that calls createThread("${key}") is imported during boot.`,
    )
  }
  return factory() as unknown as AnyThread & { __config: { /* keep typings stable */ } }
}

export function getThreadFactory(key: ThreadKey) {
  const factory = registry.get(key)
  if (!factory) {
    throw new Error(
      `Thread "${key}" is not registered. Ensure the module that calls createThread("${key}") is imported during boot.`,
    )
  }
  return factory
}

export function listThreads() {
  return Array.from(registry.keys())
}


