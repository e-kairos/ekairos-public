import type { ModelMessage, UIMessage, UIMessageChunk } from "ai"

import type { ContextEnvironment } from "../context.config.js"
import { getContextRuntimeServices } from "../context.runtime.js"
import type { ContextModelInit } from "../context.engine.js"
import type { ContextItem, ContextIdentifier } from "../context.store.js"
import { OUTPUT_ITEM_TYPE } from "../context.events.js"
import {
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
} from "../context.step-stream.js"
import { mapAiSdkChunkToContextEvent } from "./ai-sdk.chunk-map.js"
import {
  actionSpecToAiSdkTool,
  type SerializableActionSpec,
} from "../tools-to-model-tools.js"
import { writeContextTraceEvents } from "../steps/trace.steps.js"

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

async function resolveWorkflowRunId(env: ContextEnvironment, executionId?: string) {
  let runId = ""
  const meta = await readWorkflowMetadata()
  if (meta && meta.workflowRunId !== undefined && meta.workflowRunId !== null) {
    runId = String(meta.workflowRunId)
  }

  if (!runId && executionId) {
    try {
      const { getContextRuntime } = await import("../runtime.js")
      const runtime = await getContextRuntime(env)
      const db: any = (runtime as any)?.db
      if (db) {
        const q = await db.query({
          event_executions: {
            $: { where: { id: String(executionId) }, limit: 1 },
          },
        })
        const row = (q as any)?.event_executions?.[0]
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
 * AI SDK-backed reaction execution inside a single workflow step.
 *
 * Provider-specific responsibilities live here:
 * - load items from store
 * - build model messages
 * - stream through the AI SDK
 * - map provider chunks to the Context stream contract
 * - emit UI chunks and persist step stream chunks
 */
export async function executeAiSdkReaction(params: {
  runtime: import("../context.runtime.js").ContextRuntime<ContextEnvironment>
  env: ContextEnvironment
  contextIdentifier: ContextIdentifier
  events?: ContextItem[]
  model: ContextModelInit
  system: string
  tools: Record<string, SerializableActionSpec>
  eventId: string
  iteration?: number
  maxSteps: number
  sendStart?: boolean
  silent?: boolean
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<UIMessageChunk>
  executionId?: string
  contextId?: string
  stepId?: string
}): Promise<{
  assistantEvent: ContextItem
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

  const { store } = await getContextRuntimeServices(params.runtime)

  let events: ContextItem[] = Array.isArray(params.events) ? params.events : []
  if (events.length === 0) {
    try {
      events = await store.getItems(params.contextIdentifier)
    } catch (error) {
      console.error("[ekairos/story] ai-sdk.step store.getItems failed")
      throw error
    }
  }

  let messagesForModel: ModelMessage[]
  try {
    messagesForModel = (await store.itemsToModelMessages(events)) as ModelMessage[]
  } catch (error) {
    console.error(
      "[ekairos/story] ai-sdk.step store.itemsToModelMessages failed",
      safeErrorJson(error),
    )
    throw error
  }

  const { jsonSchema, gateway, smoothStream, stepCountIs, streamText } = await import("ai")
  const { extractToolCallsFromParts } = await import("../context.toolcalls.js")

  const resolvedModel =
    typeof params.model === "string"
      ? gateway(params.model)
      : typeof params.model === "function"
        ? await params.model()
        : (() => {
            throw new Error(
              "Invalid model init passed to executeAiSdkReaction. Expected a model id string or an async model factory.",
            )
          })()

  const toolsForStreamText: Record<string, any> = {}
  for (const [name, t] of Object.entries(params.tools)) {
    toolsForStreamText[name] = actionSpecToAiSdkTool(name, t, jsonSchema)
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

  result.consumeStream()

  let resolveFinish!: (value: ContextItem) => void
  let rejectFinish!: (reason?: unknown) => void
  let chunkSequence = 0

  const finishPromise = new Promise<ContextItem>((resolve, reject) => {
    resolveFinish = resolve
    rejectFinish = reject
  })

  const modelId = typeof params.model === "string" ? params.model : ""
  const mappedProvider =
    modelId.includes("/") ? modelId.split("/")[0] : undefined

  const contextStepStreamWriter = params.contextStepStream?.getWriter()

  try {
    const uiStream = result
      .toUIMessageStream({
        sendStart: Boolean(params.sendStart),
        generateMessageId: () => params.eventId,
        messageMetadata() {
          return { eventId: params.eventId }
        },
        onFinish: ({ messages }: { messages: UIMessage[] }) => {
          const lastMessage = messages[messages.length - 1]
          const event: ContextItem = {
            id: params.eventId,
            type: OUTPUT_ITEM_TYPE,
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
      .pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          async transform(chunk, controller) {
            const contextId =
              typeof params.contextId === "string" && params.contextId.length > 0
                ? params.contextId
                : undefined

            if (contextId) {
              const mapped = mapAiSdkChunkToContextEvent({
                chunk,
                contextId,
                executionId: params.executionId,
                stepId: params.stepId,
                itemId: params.eventId,
                provider: mappedProvider,
                sequence: ++chunkSequence,
              })
              const persistedChunk = createContextStepStreamChunk({
                at: mapped.at,
                sequence: mapped.sequence,
                chunkType: mapped.chunkType,
                provider: mapped.provider,
                providerChunkType: mapped.providerChunkType,
                actionRef: mapped.actionRef,
                data:
                  mapped.data && typeof mapped.data === "object"
                    ? (mapped.data as Record<string, unknown>)
                    : undefined,
                raw:
                  mapped.raw && typeof mapped.raw === "object"
                    ? (mapped.raw as Record<string, unknown>)
                    : undefined,
              })

              if (contextStepStreamWriter) {
                await contextStepStreamWriter.write(
                  encodeContextStepStreamChunk(persistedChunk),
                )
              }

              controller.enqueue({
                type: "data-chunk.emitted",
                data: mapped,
              } as unknown as UIMessageChunk)
            }

            if (chunk.type === "finish") return
            controller.enqueue(chunk)
          },
        }),
      )

    if (params.writable) {
      await uiStream.pipeTo(params.writable, { preventClose: true })
    } else {
      const reader = uiStream.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } finally {
        reader.releaseLock()
      }
    }
  } finally {
    const streamWriter: any = contextStepStreamWriter
    if (typeof streamWriter?.releaseLock === "function") {
      streamWriter.releaseLock()
    }
  }

  const assistantEvent = await finishPromise
  const finishedAtMs = Date.now()
  const toolCalls = extractToolCallsFromParts((assistantEvent as any)?.content?.parts)

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

  const provider =
    modelId.includes("/") ? modelId.split("/")[0] : (providerMetadata?.provider as string | undefined)
  const model = modelId.includes("/") ? modelId.split("/").slice(1).join("/") : (providerMetadata?.model as string | undefined)

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
      await writeContextTraceEvents({
        env: params.env,
        events: [
          {
            workflowRunId: runId,
            eventId: `context_llm:${String(params.executionId ?? "unknown")}:${String(
              params.stepId ?? params.eventId,
            )}:${String(params.iteration ?? 0)}`,
            eventKind: "context.llm",
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
