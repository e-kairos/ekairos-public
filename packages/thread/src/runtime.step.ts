/**
 * Internal helper to resolve Thread runtime from within workflow steps.
 *
 * Why dynamic import?
 * - Some bundlers (notably Turbopack step bundles) can drop/hoist static imports in "use-step" modules.
 * - Keeping `resolveRuntime` behind a dynamic import makes symbol resolution local to step execution.
 */
import type { ThreadEnvironment, ThreadRuntime } from "./thread.config.js"
import { coerceThreadRuntime } from "./thread.config.js"
import { threadDomain } from "./schema.js"

export async function getThreadRuntime(env: ThreadEnvironment): Promise<ThreadRuntime> {
  const { resolveRuntime } = await import("@ekairos/domain/runtime")
  const resolved = await resolveRuntime(threadDomain, env)
  return await coerceThreadRuntime(resolved)
}
