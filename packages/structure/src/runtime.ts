/**
 * Internal helper to resolve Story runtime from within workflow steps.
 *
 * Why dynamic import?
 * - Some bundlers (notably Turbopack step bundles) can drop/hoist static imports in "use-step" modules,
 *   causing `ReferenceError: getContextRuntime is not defined`.
 * - Using a dynamic import keeps the symbol resolution local to the step runtime.
 */
export async function getContextRuntime(env: any) {
  const { getContextRuntime } = await import("@ekairos/events/runtime")
  return await getContextRuntime(env)
}

