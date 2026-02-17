import { getRegisteredStep } from "./registry"
import { engine } from "../storyEngine"

export async function executeRegisteredStep(params: { implementationKey: string; contextId: string; args: any }) {
  "use step"
  // 1) Intentar step registrado explícito
  const step = getRegisteredStep(params.implementationKey)
  if (step) {
    try {
      const result = await step({ contextId: params.contextId, ...(params.args ?? {}) })
      return { success: true, result }
    } catch (error: any) {
      return { success: false, message: error?.message ?? String(error) }
    }
  }
  // 2) Intentar acción runtime desde storyEngine (no serializable)
  // Buscamos una story que tenga esta implementación
  try {
    const stories = (globalThis as any)[Symbol.for("PULZAR_STORY_ENGINE")]?.stories as Map<string, any> | undefined
    if (stories) {
      for (const [, rt] of stories) {
        const action = rt.actions?.[params.implementationKey]
        if (action && typeof action.execute === "function") {
          const result = await action.execute({ contextId: params.contextId, ...(params.args ?? {}) })
          return { success: true, result }
        }
      }
    }
  } catch (error: any) {
    return { success: false, message: error?.message ?? String(error) }
  }
  return { success: false, message: `Step not found: ${params.implementationKey}` }
}


