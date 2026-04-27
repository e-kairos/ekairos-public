import { z } from "zod"

/**
 * Serializable "tool" shape to pass across the Workflow step boundary.
 *
 * Mirrors Workflow DevKit's DurableAgent strategy:
 * - Keep Zod/function values out of step arguments
 * - Convert tool input schemas to plain JSON Schema in workflow context
 */
export type SerializableFunctionActionSpec = {
  type?: "function"
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
  providerOptions?: unknown
}

export type SerializableProviderDefinedActionSpec = {
  type: "provider-defined"
  id: string
  name?: string
  args?: Record<string, unknown>
}

export type SerializableActionSpec =
  | SerializableFunctionActionSpec
  | SerializableProviderDefinedActionSpec

function toJsonSchema(schema: unknown): unknown {
  if (!schema) return schema
  const jsonSchema = (schema as { jsonSchema?: unknown })?.jsonSchema
  if (jsonSchema) return jsonSchema
  try {
    return z.toJSONSchema(schema as never)
  } catch {
    return schema
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

/**
 * @deprecated Use SerializableActionSpec.
 */
export type SerializableToolForModel = SerializableActionSpec

function isProviderDefinedTool(tool: unknown): tool is {
  type: "provider-defined"
  id: string
  name?: string
  args?: Record<string, unknown>
} {
  const record = asRecord(tool)
  return (
    record.type === "provider-defined" &&
    typeof record.id === "string" &&
    record.id.trim().length > 0
  )
}

/**
 * Convert AI SDK tools to a serializable representation that can be passed to `"use-step"` functions.
 *
 * This matches DurableAgent's internal `toolsToModelTools` behavior:
 * `inputSchema: asSchema(tool.inputSchema).jsonSchema`
 */
export function actionsToActionSpecs(
  tools: Record<string, unknown>,
): Record<string, SerializableActionSpec> {
  const out: Record<string, SerializableActionSpec> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (isProviderDefinedTool(tool)) {
      out[name] = {
        type: "provider-defined",
        id: tool.id,
        name: tool.name,
        args: tool.args,
      }
      continue
    }

    const record = asRecord(tool)
    const inputSchema = record.inputSchema ?? record.input
    if (!inputSchema) {
      throw new Error(
        `Context: action "${name}" is missing input/inputSchema (required for model action calls)`,
      )
    }
    const outputSchema = record.outputSchema ?? record.output
    out[name] = {
      type: "function",
      description: typeof record.description === "string" ? record.description : undefined,
      inputSchema: toJsonSchema(inputSchema),
      outputSchema: outputSchema ? toJsonSchema(outputSchema) : undefined,
      providerOptions: record.providerOptions,
    }
  }
  return out
}

export function actionSpecToAiSdkTool(
  name: string,
  spec: SerializableActionSpec,
  wrapJsonSchema: (schema: unknown) => unknown,
) {
  if (spec.type === "provider-defined") {
    return {
      type: "provider-defined" as const,
      id: spec.id,
      name: spec.name ?? name,
      args: spec.args ?? {},
    }
  }

  return {
    type: "function" as const,
    description: spec.description,
    inputSchema: wrapJsonSchema(spec.inputSchema),
    outputSchema: spec.outputSchema ? wrapJsonSchema(spec.outputSchema) : undefined,
    providerOptions: spec.providerOptions,
  }
}

/**
 * @deprecated Use actionsToActionSpecs.
 */
export const toolsToModelTools = actionsToActionSpecs





