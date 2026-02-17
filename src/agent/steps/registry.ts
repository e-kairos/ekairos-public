// Registro simple de steps por clave de implementación
// Cada step debe ser una función que internamente use "use step"

export type RegisteredStep = (args: any) => Promise<any>

const GLOBAL_STEP_REGISTRY_SYMBOL = Symbol.for("PULZAR_STEP_REGISTRY")

function getRegistry(): Map<string, RegisteredStep> {
  const g = globalThis as any
  if (!g[GLOBAL_STEP_REGISTRY_SYMBOL]) {
    g[GLOBAL_STEP_REGISTRY_SYMBOL] = new Map<string, RegisteredStep>()
  }
  return g[GLOBAL_STEP_REGISTRY_SYMBOL] as Map<string, RegisteredStep>
}

export function registerStep(key: string, fn: RegisteredStep) {
  if (!key || typeof key !== "string") throw new Error("registerStep: key inválida")
  if (typeof fn !== "function") throw new Error("registerStep: fn inválida")
  getRegistry().set(key, fn)
}

export function getRegisteredStep(key: string): RegisteredStep | undefined {
  return getRegistry().get(key)
}

export function listRegisteredSteps(): string[] {
  return Array.from(getRegistry().keys())
}


