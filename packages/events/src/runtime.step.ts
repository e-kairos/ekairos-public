/**
 * Internal helper to resolve Context runtime from within workflow steps.
 *
 * Why dynamic import?
 * - Some bundlers (notably Turbopack step bundles) can drop/hoist static imports in "use-step" modules.
 * - Keeping `resolveRuntime` behind a dynamic import makes symbol resolution local to step execution.
 */
import type { ContextEnvironment, ContextRuntime } from "./context.config.js"
import { coerceContextRuntime } from "./context.config.js"
import { eventsDomain } from "./schema.js"

export async function getContextRuntime(env: ContextEnvironment): Promise<ContextRuntime> {
  const { resolveRuntime } = await import("@ekairos/domain/runtime")
  const resolved = await resolveRuntime(eventsDomain, env)
  return await coerceContextRuntime(resolved, env)
}
