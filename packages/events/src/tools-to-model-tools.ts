import { asSchema, type Tool } from "ai"

/**
 * Serializable "tool" shape to pass across the Workflow step boundary.
 *
 * Mirrors Workflow DevKit's DurableAgent strategy:
 * - Keep Zod/function values out of step arguments
 * - Convert tool input schemas to plain JSON Schema in workflow context
 */
export type SerializableActionSpec = {
  description?: string
  inputSchema: unknown
}

/**
 * @deprecated Use SerializableActionSpec.
 */
export type SerializableToolForModel = SerializableActionSpec

/**
 * Convert AI SDK tools to a serializable representation that can be passed to `"use-step"` functions.
 *
 * This matches DurableAgent's internal `toolsToModelTools` behavior:
 * `inputSchema: asSchema(tool.inputSchema).jsonSchema`
 */
export function actionsToActionSpecs(
  tools: Record<string, Tool>,
): Record<string, SerializableActionSpec> {
  const out: Record<string, SerializableActionSpec> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const inputSchema = (tool as any)?.inputSchema
    if (!inputSchema) {
      throw new Error(
        `Context: tool "${name}" is missing inputSchema (required for model tool calls)`,
      )
    }
    out[name] = {
      description: (tool as any)?.description,
      inputSchema: asSchema(inputSchema).jsonSchema,
    }
  }
  return out
}

/**
 * @deprecated Use actionsToActionSpecs.
 */
export const toolsToModelTools = actionsToActionSpecs





