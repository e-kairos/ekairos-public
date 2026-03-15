import type {
  ContextDurableWorkflowFunction,
  ContextReactResult,
  ContextDurableWorkflowPayload,
} from "./context.engine.js"
import type { ContextEnvironment } from "./context.config.js"

const durableWorkflowSymbol = Symbol.for("ekairos.events.contextDurableWorkflow")

type DurableWorkflowStore = typeof globalThis & {
  [durableWorkflowSymbol]?: ContextDurableWorkflowFunction<any, any>
}

export function configureContextDurableWorkflow<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  workflow: ContextDurableWorkflowFunction<Context, Env> | null,
) {
  if (typeof globalThis === "undefined") return
  const store = globalThis as DurableWorkflowStore
  store[durableWorkflowSymbol] = workflow ?? undefined
}

export function getContextDurableWorkflow() {
  if (typeof globalThis === "undefined") return undefined
  const store = globalThis as DurableWorkflowStore
  return store[durableWorkflowSymbol]
}

export type {
  ContextDurableWorkflowFunction,
  ContextDurableWorkflowPayload,
  ContextReactResult,
}
