import { streamText, tool, type Tool, stepCountIs } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import { id } from "@instantdb/admin"
import { createAssistantEventFromUIMessages } from "../events"

type PrimitiveType = "string" | "number" | "boolean" | "object" | "array"

type FieldSchema = {
  type: PrimitiveType
  description?: string
  required?: boolean
  properties?: Record<string, FieldSchema>
  items?: FieldSchema
}

type StepInputSchema = {
  type: "object"
  description?: string
  properties?: Record<string, FieldSchema>
}

type StoryActionSpec = {
  name: string
  description: string
  implementationKey: string
  inputSchema?: StepInputSchema
  finalize?: boolean
}

type StoryOptions = {
  reasoningEffort?: "low" | "medium" | "high"
  webSearch?: boolean
  includeBaseTools?: { createMessage?: boolean; requestDirection?: boolean; end?: boolean }
}

function zodFromField(field: FieldSchema): z.ZodTypeAny {
  switch (field.type) {
    case "string":
      return z.string().describe(field.description ?? "")
    case "number":
      return z.number().describe(field.description ?? "")
    case "boolean":
      return z.boolean().describe(field.description ?? "")
    case "array":
      if (!field.items) return z.array(z.any()).describe(field.description ?? "")
      return z.array(zodFromField(field.items)).describe(field.description ?? "")
    case "object":
      return z.object(Object.fromEntries(Object.entries(field.properties ?? {}).map(([k, v]) => [k, zodFromField(v)])))
        .describe(field.description ?? "")
    default:
      return z.any()
  }
}

function zodFromSchema(schema?: StepInputSchema): z.ZodTypeAny {
  if (!schema || schema.type !== "object") return z.object({}).strict()
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const base = zodFromField(field)
    shape[name] = field.required ? base : base.optional()
  }
  const obj = z.object(shape)
  return obj
}

export async function runReasoningOnceStep(params: {
  contextId: string
  systemPrompt: string
  actions: StoryActionSpec[]
  options: StoryOptions
}): Promise<{ toolCalls: Array<{ toolCallId: string; toolName: string; args: any }> }> {
  "use step"

  // Construir tools para el modelo sin ejecutar (sin execute)
  const tools: Record<string, Tool> = {}
  const includeBase = params.options?.includeBaseTools || { createMessage: true, requestDirection: true, end: true }
  
  for (const action of params.actions) {
    const inputSchema = zodFromSchema(action.inputSchema)
    tools[action.name] = tool({
      description: action.description,
      inputSchema: inputSchema,
    })
  }
  
  if (includeBase.createMessage) {
    tools.createMessage = tool({
      description: "Send a message to the user. Use for final confirmations or information.",
      inputSchema: z.object({ message: z.string().describe("Markdown content") }),
    })
  }
  if (includeBase.requestDirection) {
    tools.requestDirection = tool({
      description: "Ask a human for guidance when blocked or unsure.",
      inputSchema: z.object({ issue: z.string(), context: z.string(), suggestedActions: z.array(z.string()).optional(), urgency: z.enum(["low","medium","high"]).default("medium") }),
    })
  }
  if (includeBase.end) {
    tools.end = tool({
      description: "End the current interaction loop.",
      inputSchema: z.object({}).strict(),
    })
  }

  const providerOptions: any = {}
  if (params.options?.reasoningEffort) {
    providerOptions.openai = {
      reasoningEffort: params.options.reasoningEffort,
      reasoningSummary: "detailed",
    }
  }

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: params.systemPrompt,
    messages: [],
    tools,
    toolChoice: "required",
    stopWhen: stepCountIs(1),
    ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
  })

  result.consumeStream()

  let resolveFinish!: (value: any) => void
  let rejectFinish!: (reason?: unknown) => void
  const finishPromise = new Promise<any>((resolve, reject) => {
    resolveFinish = resolve
    rejectFinish = reject
  })

  const eventId = id()

  result
    .toUIMessageStream({
      sendStart: false,
      generateMessageId: () => eventId,
      messageMetadata() {
        return { eventId }
      },
      onFinish: ({ messages }) => {
        const lastEvent = createAssistantEventFromUIMessages(eventId, messages)
        resolveFinish(lastEvent)
      },
      onError: (e: unknown) => {
        rejectFinish(e)
        const message = e instanceof Error ? e.message : String(e)
        return message
      },
    })
    .pipeThrough(
      new TransformStream({
        transform(chunk: any, controller: any) {
          if (chunk.type === "start") return
          if (chunk.type === "finish-step") return
          if (chunk.type === "start-step") return
          if (chunk.type === "finish") return
          controller.enqueue(chunk as any)
        },
      })
    )

  const lastEvent = await finishPromise

  const toolCalls: Array<{ toolCallId: string; toolName: string; args: any }> = []
  try {
    for (const p of lastEvent.content.parts || []) {
      if (typeof p.type === "string" && p.type.startsWith("tool-")) {
        const toolName = p.type.split("-")[1]
        toolCalls.push({ toolCallId: p.toolCallId, toolName, args: p.input })
      }
    }
  } catch { }

  return { toolCalls }
}


