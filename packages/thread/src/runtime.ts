/**
 * Runtime-only entrypoint for @ekairos/thread.
 *
 * This file intentionally exports the "wiring" pieces that connect durable steps to a concrete
 * store runtime (Instant/Postgres/etc).
 *
 * IMPORTANT:
 * - Do NOT import this entrypoint from client/browser code.
 * - Keep `@ekairos/thread` main entrypoint safe to import from schema/domain modules.
 */

if (typeof (globalThis as any).Event === "undefined") {
  class NodeEvent {
    type: string;
    constructor(type: string, init?: { [key: string]: unknown }) {
      this.type = type;
      if (init && typeof init === "object") {
        Object.assign(this, init);
      }
    }
  }
  (globalThis as any).Event = NodeEvent;
}

export {
  getThreadRuntime,
} from "./runtime.step.js"

export type { ThreadEnvironment, ThreadRuntime } from "./thread.config.js"

export { registerThreadEnv, getThreadEnv } from "./env.js"

export type RegistrableThread = {
  key?: string
  register: () => void
}




