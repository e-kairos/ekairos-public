/**
 * Internal helper to resolve Story runtime from within workflow steps.
 *
 * Why dynamic import?
 * - Some bundlers (notably Turbopack step bundles) can drop/hoist static imports in "use-step" modules,
 *   causing `ReferenceError: getThreadRuntime is not defined`.
 * - Using a dynamic import keeps the symbol resolution local to the step runtime.
 */
export async function getThreadRuntime(env: any) {
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  return await getThreadRuntime(env)
}

