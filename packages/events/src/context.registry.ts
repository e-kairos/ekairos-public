import type { ContextEnvironment } from "./context.config.js"
import type { ContextInstance } from "./context.builder.js"

export type ContextKey = string

type AnyContext = ContextInstance<any, any, any>

export type ContextFactory = () => AnyContext

const registry = new Map<ContextKey, ContextFactory>()

export function registerContext(key: ContextKey, factory: ContextFactory) {
  if (!key || typeof key !== "string") {
    throw new Error("registerContext: key must be a non-empty string")
  }
  if (typeof factory !== "function") {
    throw new Error("registerContext: factory must be a function")
  }
  registry.set(key, factory)
}

export function hasContext(key: ContextKey) {
  return registry.has(key)
}

export function getContext<Env extends ContextEnvironment = ContextEnvironment>(key: ContextKey) {
  const factory = registry.get(key)
  if (!factory) {
    throw new Error(
      `Context "${key}" is not registered. Ensure the module that calls createContext("${key}") is imported during boot.`,
    )
  }
  return factory() as unknown as AnyContext & { __config: { /* keep typings stable */ } }
}

export function getContextFactory(key: ContextKey) {
  const factory = registry.get(key)
  if (!factory) {
    throw new Error(
      `Context "${key}" is not registered. Ensure the module that calls createContext("${key}") is imported during boot.`,
    )
  }
  return factory
}

export function listContexts() {
  return Array.from(registry.keys())
}
