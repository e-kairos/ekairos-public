import type { ModelMessage, UIMessage, UIMessageChunk } from "ai"

import type { ThreadEnvironment } from "../thread.config.js"
import type { ThreadItem, ContextIdentifier } from "../thread.store.js"
import { OUTPUT_TEXT_ITEM_TYPE } from "../thread.events.js"
import type { SerializableToolForModel } from "../tools-to-model-tools.js"
import { writeThreadTraceEvents } from "./trace.steps.js"

type WorkflowMeta = {
  workflowRunId?: string | number
  [key: string]: unknown
}

async function readWorkflowMetadata(): Promise<WorkflowMeta | null> {
  try {
    const { getWorkflowMetadata } = await import("workflow")
    return ((getWorkflowMetadata?.() as unknown) as WorkflowMeta) ?? null
  } catch {
    return null
  }
}

async function resolveWorkflowRunId(env: ThreadEnvironment, executionId?: string) {
  const meta = await readWorkflowMetadata()
  let runId =
    meta && meta.workflowRunId !== undefined && meta.workflowRunId !== null
      ? String(meta.workflowRunId)
      : ""

  if (!runId) {
    const envRunId = (env as any)?.workflowRunId
    if (typeof envRunId === "string" && envRunId.trim()) {
      runId = envRunId.trim()
    }
  }

  if (!runId && executionId) {
    try {
      const { getThreadRuntime } = await import("@ekairos/thread/runtime")
      const runtime = await getThreadRuntime(env)
      const db: any = (runtime as any)?.db
      if (db) {
        const q = await db.query({
          thread_executions: {
            $: { where: { id: String(executionId) }, limit: 1 },
          },
        })
        const row = (q as any)?.thread_executions?.[0]
        if (row?.workflowRunId) {
          runId = String(row.workflowRunId)
        }
      }
    } catch {
      // ignore
    }
  }

  return runId || undefined
}

function safeErrorJson(error: unknown) {
  const seen = new WeakSet<object>()
  const redactKey = (k: string) =>
    /token|authorization|cookie|secret|api[_-]?key|password/i.test(k)

  const err: any = error as any
  const payload = {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    body: err?.body,
    data: err?.data,
    stack: err?.stack,
  }

  try {
    return JSON.stringify(payload, (k, v) => {
      if (redactKey(k)) return "[redacted]"
      if (typeof v === "string" && v.length > 5_000) return "[truncated-string]"
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]"
        seen.add(v)
      }
      return v
    })
  } catch {
    return JSON.stringify({ message: String(err?.message ?? "error") })
  }
}

/**
 * Executes a full "reaction" inside a single workflow step:
 * - load events from store
 * - convert events to model messages
 * - run the streaming model call and emit chunks
 * - extract tool calls from the resulting assistant event
 */
export async function executeReaction(params: {
  env: ThreadEnvironment
  contextIdentifier: ContextIdentifier
  model: any
  system: string
  tools: Record<string, SerializableToolForModel>
  eventId: string
  iteration?: number
  maxSteps: number
  sendStart?: boolean
  silent?: boolean
  writable?: WritableStream<UIMessageChunk>
  executionId?: string
  contextId?: string
  stepId?: string
}): Promise<{
  assistantEvent: ThreadItem
  toolCalls: any[]
  messagesForModel: ModelMessage[]
  llm?: {
    provider?: string
    model?: string
    promptTokens?: number
    promptTokensCached?: number
    promptTokensUncached?: number
    completionTokens?: number
    totalTokens?: number
    latencyMs?: number
    rawUsage?: any
    rawProviderMetadata?: any
  }
}> {
  "use step"

  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const { store } = await getThreadRuntime(params.env)

  let events: ThreadItem[]
  try {
    events = await store.getItems(params.contextIdentifier)
  } catch (error) {
    console.error("[ekairos/story] reaction.step store.getItems failed")
    throw error
  }

  let messagesForModel: ModelMessage[]
  try {
    messagesForModel = (await store.itemsToModelMessages(events)) as ModelMessage[]
  } catch (error) {
    console.error("[ekairos/story] reaction.step store.itemsToModelMessages failed", safeErrorJson(error))
    throw error
  }

  const writable =
    params.silent || !params.writable
      ? (new WritableStream<UIMessageChunk>({ write() {} }) as any)
      : params.writable

  const { jsonSchema, gateway, smoothStream, stepCountIs, streamText } = await import("ai")
  const { extractToolCallsFromParts } = await import("@ekairos/thread")

  const isMockModelConfig = (value: any): value is {
    source?: "mock"
    provider?: string
    modelId?: string
    toolName?: string
  } => {
    if (!value || typeof value !== "object") return false
    if ("specificationVersion" in value) return false
    if (value.source === "mock") return true
    return typeof value.provider === "string" && typeof value.modelId === "string"
  }

  const buildMockModel = async (config: {
    provider?: string
    modelId?: string
    toolName?: string
  }): Promise<any> => {
    const toolName =
      typeof config.toolName === "string" && config.toolName.trim()
        ? config.toolName.trim()
        : Object.keys(params.tools || {})[0] || "tool"
    const provider = config.provider ?? "mock-provider"
    const modelId = config.modelId ?? "mock-model-id"
    return {
      specificationVersion: "v2",
      provider,
      modelId,
      supportedUrls: {},
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "mock-tool-call",
            toolName,
            input: JSON.stringify({ instruction: "" }),
          },
        ],
        finishReason: "tool-calls",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }),
      doStream: async () => {
        const toolCallId = `mock-tool-${Date.now()}`
        const stream = new ReadableStream<any>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({
              type: "tool-call",
              toolCallId,
              toolName,
              input: JSON.stringify({ instruction: "" }),
            })
            controller.enqueue({
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            })
            controller.close()
          },
        })
        return { stream }
      },
    }
  }

  // Match DurableAgent-style model init behavior:
  const resolvedModel =
    typeof params.model === "string"
      ? gateway(params.model)
      : isMockModelConfig(params.model)
        ? await buildMockModel(params.model)
      : typeof params.model === "function"
        ? await params.model()
        : params.model

  // Wrap plain JSON Schema objects so the AI SDK doesn't attempt Zod conversion at runtime.
  const toolsForStreamText: Record<string, any> = {}
  for (const [name, t] of Object.entries(params.tools)) {
    toolsForStreamText[name] = {
      description: (t as any)?.description,
      inputSchema: jsonSchema((t as any).inputSchema),
    }
  }

  const startedAtMs = Date.now()
  const result = streamText({
    model: resolvedModel,
    system: params.system,
    messages: messagesForModel as any,
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
  const finishedAtMs = Date.now()
  const toolCalls = extractToolCallsFromParts((assistantEvent as any)?.content?.parts)

  // Best-effort usage extraction (AI SDK provider dependent).
  // We keep this loose because providers differ and SDK evolves quickly.
  const latencyMs = Math.max(0, finishedAtMs - startedAtMs)
  let usage: any = undefined
  let providerMetadata: any = undefined

  try {
    usage = (result as any)?.usage
    if (typeof usage?.then === "function") usage = await usage
  } catch {
    usage = undefined
  }

  try {
    providerMetadata =
      (result as any)?.providerMetadata ??
      (result as any)?.experimental_providerMetadata ??
      (result as any)?.response?.providerMetadata ??
      undefined
  } catch {
    providerMetadata = undefined
  }

  // Workflow steps must return serializable values. Provider SDKs may include
  // classes/streams/etc in metadata, so we defensively sanitize.
  function toPlainJson(value: unknown) {
    if (typeof value === "undefined") return undefined
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return undefined
    }
  }
  const usageJson = toPlainJson(usage)
  const providerMetadataJson = toPlainJson(providerMetadata)

  // Derive provider/model from gateway id when available.
  const modelId = typeof params.model === "string" ? params.model : ""
  const provider =
    modelId.includes("/") ? modelId.split("/")[0] : (providerMetadata?.provider as string | undefined)
  const model = modelId.includes("/") ? modelId.split("/").slice(1).join("/") : (providerMetadata?.model as string | undefined)

  // Token accounting: attempt to read cached prompt tokens from OpenAI-like usage shapes.
  const promptTokens = Number(usage?.promptTokens ?? usage?.prompt_tokens ?? usage?.inputTokens ?? 0) || 0
  const completionTokens =
    Number(usage?.completionTokens ?? usage?.completion_tokens ?? usage?.outputTokens ?? 0) || 0
  const totalTokens = Number(usage?.totalTokens ?? usage?.total_tokens ?? 0) || (promptTokens + completionTokens)

  const cachedPromptTokens =
    Number(
      usage?.promptTokensCached ??
        usage?.cached_prompt_tokens ??
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.input_tokens_details?.cached_tokens ??
        0,
    ) || 0
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens)

  const llm =
    promptTokens || completionTokens || cachedPromptTokens
      ? {
          provider,
          model,
          promptTokens,
          promptTokensCached: cachedPromptTokens,
          promptTokensUncached: uncachedPromptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          rawUsage: usageJson,
          rawProviderMetadata: providerMetadataJson,
        }
      : {
          provider,
          model,
          latencyMs,
          rawUsage: usageJson,
          rawProviderMetadata: providerMetadataJson,
        }

  try {
    const runId = await resolveWorkflowRunId(params.env, params.executionId)
    if (runId && llm) {
      await writeThreadTraceEvents({
        env: params.env,
        events: [
          {
            workflowRunId: runId,
            eventId: `thread_llm:${String(params.executionId ?? "unknown")}:${String(
              params.stepId ?? params.eventId,
            )}:${String(params.iteration ?? 0)}`,
            eventKind: "thread.llm",
            eventAt: new Date().toISOString(),
            contextId: params.contextId,
            executionId: params.executionId,
            stepId: params.stepId,
            aiProvider: typeof llm.provider === "string" ? llm.provider : undefined,
            aiModel: typeof llm.model === "string" ? llm.model : undefined,
            promptTokens: Number.isFinite(Number(llm.promptTokens))
              ? Number(llm.promptTokens)
              : undefined,
            promptTokensCached: Number.isFinite(Number(llm.promptTokensCached))
              ? Number(llm.promptTokensCached)
              : undefined,
            promptTokensUncached: Number.isFinite(Number(llm.promptTokensUncached))
              ? Number(llm.promptTokensUncached)
              : undefined,
            completionTokens: Number.isFinite(Number(llm.completionTokens))
              ? Number(llm.completionTokens)
              : undefined,
            totalTokens: Number.isFinite(Number(llm.totalTokens))
              ? Number(llm.totalTokens)
              : undefined,
            latencyMs: Number.isFinite(Number(llm.latencyMs))
              ? Number(llm.latencyMs)
              : undefined,
            payload: {
              provider: llm.provider,
              model: llm.model,
              usage: llm.rawUsage,
              providerMetadata: llm.rawProviderMetadata,
              iteration: params.iteration,
            },
          },
        ],
      })
    }
  } catch {
    // tracing must not break reaction
  }

  return { assistantEvent, toolCalls, messagesForModel, llm }
}


