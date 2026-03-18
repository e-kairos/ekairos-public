/**
 * Runtime-only entrypoint for @ekairos/events.
 *
 * This file intentionally exports the "wiring" pieces that connect durable steps to a concrete
 * store runtime (Instant/Postgres/etc).
 *
 * IMPORTANT:
 * - Do NOT import this entrypoint from client/browser code.
 * - Keep `@ekairos/events` main entrypoint safe to import from schema/domain modules.
 */

if (typeof (globalThis as any).Event === "undefined") {
  class NodeEvent {
    type: string
    constructor(type: string, init?: { [key: string]: unknown }) {
      this.type = type
      if (init && typeof init === "object") {
        Object.assign(this, init)
      }
    }
  }
  ;(globalThis as any).Event = NodeEvent
}

export {
  getContextRuntime,
} from "./runtime.step.js"

export {
  createContextStepStreamClientId,
  createPersistedContextStepStream,
  readPersistedContextStepStream,
  resolveContextExecutionStreamPointer,
  waitForContextExecutionStreamPointer,
} from "./steps/stream.steps.js"

export type { ContextEnvironment, ContextRuntime } from "./context.config.js"

export { registerContextEnv, getContextEnv } from "./env.js"
export { configureContextDurableWorkflow } from "./context.durable.js"

export type RegistrableContext = {
  key?: string
  register: () => void
}
