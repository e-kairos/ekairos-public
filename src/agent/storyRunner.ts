import { engine, type StoryDescriptor } from "./storyEngine"
import { ensureContextStep, buildSystemPromptStep } from "./steps/context"
import { runReasoningOnceStep } from "./steps/ai"
import { executeRegisteredStep } from "./steps/base"

type ToolCall = { toolCallId: string; toolName: string; args: any }

export async function storyRunner(serialized: StoryDescriptor, args?: { context?: any }) {
  "use workflow"

  const maxLoops = 10

  const { contextId } = await ensureContextStep({ key: serialized.key, context: args?.context ?? null })

  let loopCount = 0
  while (loopCount < maxLoops) {
    loopCount++

    const systemPrompt = await buildSystemPromptStep({
      contextId,
      narrative: serialized.narrative,
    })

    const { toolCalls } = await runReasoningOnceStep({
      contextId,
      systemPrompt,
      actions: serialized.actions.map((a) => ({
        name: a.name,
        description: a.description,
        implementationKey: a.implementationKey || a.name,
        inputSchema: a.inputSchema,
        finalize: a.finalize,
      })),
      options: { reasoningEffort: "medium" },
    })

    if (!toolCalls || toolCalls.length === 0) {
      break
    }

    const rt = engine.get(serialized.key)
    if (!rt) throw new Error(`Story runtime not found for key=${serialized.key}`)

    const executions = await Promise.all(
      toolCalls.map(async (tc: ToolCall) => {
        const implKey = tc.toolName
        const action = rt.actions[implKey]
        if (action && typeof action.execute === "function") {
          // Ejecutar en el runtime local (no serializable) dentro de un step wrapper
          return await executeRegisteredStep({ implementationKey: implKey, contextId, args: tc.args })
        }
        // fallback: ejecutar step registrado directo si existe
        return await executeRegisteredStep({ implementationKey: implKey, contextId, args: tc.args })
      })
    )

    const shouldEnd = executions.some((_r, i) => {
      const a = serialized.actions.find((x) => (x.implementationKey || x.name) === toolCalls[i].toolName)
      return Boolean(a?.finalize)
    })
    if (shouldEnd) break
  }

  return { success: true, contextId }
}


