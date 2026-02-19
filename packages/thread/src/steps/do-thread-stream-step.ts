import type { ModelMessage, UIMessage, UIMessageChunk } from "ai"
import type { ThreadItem } from "../thread.store.js"
import { OUTPUT_TEXT_ITEM_TYPE } from "../thread.events.js"
import type { SerializableToolForModel } from "../tools-to-model-tools.js"
import type { ThreadModelInit } from "../thread.engine.js"

/**
 * Runs a single LLM streaming step as a Workflow step.
 *
 * - Performs the provider/network call in a step (Node/runtime allowed).
 * - Pipes AI SDK UI message chunks into the workflow-owned writable stream.
 * - Returns the assistant event + extracted tool calls for the workflow loop.
 */
export async function doThreadStreamStep(params: {
  model: ThreadModelInit
  system: string
  messages: ModelMessage[]
  tools: Record<string, SerializableToolForModel>
  eventId: string
  maxSteps: number
  /**
   * Whether to emit a `start` chunk for this streamed assistant message.
   *
   * IMPORTANT:
   * Our thread loop may call the model multiple times within a single "turn" while continuing
   * to append to the same `eventId`. In that case, `start` must only be sent once.
   */
  sendStart?: boolean
}) {
  "use step"

  const { getWritable } = await import("workflow")
  const writable = getWritable<UIMessageChunk>()

  const { jsonSchema, gateway, smoothStream, stepCountIs, streamText } = await import("ai")
  const { extractToolCallsFromParts } = await import("../thread.toolcalls.js")

  // Match DurableAgent's model init behavior:
  // - string => AI Gateway model id, resolved via `gateway(...)` in the step runtime
  // - function => model factory (should be a `"use step"` function for workflow serialization)
  const resolvedModel =
    typeof params.model === "string"
      ? gateway(params.model)
      : typeof params.model === "function"
        ? await params.model()
        : (() => {
            throw new Error(
              "Invalid model init passed to doThreadStreamStep. Expected a model id string or an async model factory.",
            )
          })()

  // IMPORTANT:
  // `streamText` expects tools in the AI SDK ToolSet shape, where `inputSchema` is a Schema-like value.
  // We pass plain JSON schema objects across the step boundary (serializable), then wrap them here with
  // `jsonSchema(...)` so the AI SDK does not attempt Zod conversion at runtime.
  const toolsForStreamText: Record<string, any> = {}
  for (const [name, t] of Object.entries(params.tools)) {
    toolsForStreamText[name] = {
      description: (t as any)?.description,
      inputSchema: jsonSchema((t as any).inputSchema),
    }
  }

  const result = streamText({
    model: resolvedModel,
    system: params.system,
    messages: params.messages as any,
    tools: toolsForStreamText,
    toolChoice: "required",
    stopWhen: stepCountIs(params.maxSteps),
    experimental_transform: smoothStream({ delayInMs: 30, chunking: "word" }),
  })

  // Ensure the underlying stream is consumed (AI SDK requirement)
  result.consumeStream()

  let resolveFinish!: (value: ThreadItem) => void
  let rejectFinish!: (reason?: unknown) => void

  const finishPromise = new Promise<ThreadItem>((resolve, reject) => {
    resolveFinish = resolve
    rejectFinish = reject
  })

  const uiStream = result
    .toUIMessageStream({
      // Emit `start` only when the engine says so (typically once per turn).
      sendStart: Boolean(params.sendStart),
      generateMessageId: () => params.eventId,
      messageMetadata() {
        return { eventId: params.eventId }
      },
      onFinish: ({ messages }: { messages: UIMessage[] }) => {
        const lastMessage = messages[messages.length - 1]
        const event: ThreadItem = {
          id: params.eventId,
          type: OUTPUT_TEXT_ITEM_TYPE,
          channel: "web",
          createdAt: new Date().toISOString(),
          content: { parts: lastMessage?.parts ?? [] },
        }
        resolveFinish(event)
      },
      onError: (e: unknown) => {
        rejectFinish(e)
        return e instanceof Error ? e.message : String(e)
      },
    })
    // Filter out per-step finish boundary. Workflow will emit a single finish.
    .pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if (chunk.type === "finish") return
          controller.enqueue(chunk)
        },
      }),
    )

  await uiStream.pipeTo(writable, { preventClose: true })

  const assistantEvent = await finishPromise
  const toolCalls = extractToolCallsFromParts((assistantEvent as any)?.content?.parts)

  return {
    assistantEvent,
    toolCalls,
  }
}



