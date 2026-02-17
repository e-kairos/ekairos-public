import type { ContextIdentifier } from "./service"

// NOTA: Este módulo implementa un generador de workflows durables basado en Steps.
// Importante: el workflow (función retornada) usa la directiva "use workflow" y
// todas las operaciones con efectos (DB, IA, etc.) ocurren dentro de steps ("use step").

// Tipos serializables para describir acciones (tools)
export type PrimitiveType = "string" | "number" | "boolean" | "object" | "array"

export type FieldSchema = {
  type: PrimitiveType
  description?: string
  required?: boolean
  properties?: Record<string, FieldSchema>
  items?: FieldSchema
}

export type StepInputSchema = {
  type: "object"
  description?: string
  properties?: Record<string, FieldSchema>
}

export type StoryActionSpec = {
  name: string
  description: string
  // Clave del step ejecutor registrado en registry (ej: "dataset.executeCommand")
  implementationKey: string
  // Esquema de entrada serializable (convertible a zod en el step)
  inputSchema?: StepInputSchema
  // Si true, al ejecutar esta acción se puede finalizar el loop
  finalize?: boolean
  // Runtime-only (no serializable): ejecutor directo para engine
  execute?: (args: any & { contextId?: string }) => Promise<any>
}

export type StoryOptions = {
  reasoningEffort?: "low" | "medium" | "high"
  webSearch?: boolean
  maxLoops?: number
  finalActions?: string[]
  includeBaseTools?: { createMessage?: boolean; requestDirection?: boolean; end?: boolean }
}

export type StoryConfig = {
  narrative: string
  actions: StoryActionSpec[]
  options?: StoryOptions
}

export type StoryStartArgs = {
  context?: ContextIdentifier | null
  trigger?: any | null
}

// Resultados mínimos del loop de IA
type ToolCall = { toolCallId: string; toolName: string; args: any }

// Steps (se resuelven en tiempo de ejecución del step, no en workflow)
// Se importan como referencias; su lógica corre con "use step" dentro de cada función.
import { ensureContextStep, buildSystemPromptStep } from "./steps/context"
import { runReasoningOnceStep } from "./steps/ai"
import { executeRegisteredStep } from "./steps/base"

// story(): genera una función workflow que orquesta los steps de manera durable
export function story(key: string, config: StoryConfig) {
  // Retorna una función que orquesta la iteración del workflow (sin directiva)
  return async function runStory(args?: StoryStartArgs) {
    const maxLoops = config.options?.maxLoops ?? 10

    const { contextId } = await ensureContextStep({ key, context: args?.context ?? null })

    let loopCount = 0
    while (loopCount < maxLoops) {
      loopCount++

      const systemPrompt = await buildSystemPromptStep({
        contextId,
        narrative: config.narrative,
      })

      const { toolCalls } = await runReasoningOnceStep({
        contextId,
        systemPrompt,
        actions: config.actions,
        options: config.options ?? {},
      })

      if (!toolCalls || toolCalls.length === 0) {
        break
      }

      const executions = await Promise.all(
        toolCalls.map(async (tc: ToolCall) => {
          const action = config.actions.find((a) => a.name === tc.toolName)
          const implementationKey = (action?.implementationKey || tc.toolName) as string
          const result = await executeRegisteredStep({
            implementationKey,
            contextId,
            args: tc.args,
          })
          return { tc, action, result }
        })
      )

      const shouldEnd = executions.some(({ action }: { action: StoryActionSpec | undefined }) => {
        const isFinalByAction = Boolean(action?.finalize)
        const isFinalByOptions = action && Array.isArray(config.options?.finalActions)
          ? (config.options!.finalActions!).includes(action.name)
          : false
        return isFinalByAction || isFinalByOptions
      })

      if (shouldEnd) {
        break
      }
    }

    return { contextId, status: "completed" as const }
  }
}

export type { StoryActionSpec as StoryAction, StoryOptions as StoryConfigOptions }


