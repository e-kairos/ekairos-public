import {
  OUTPUT_ITEM_TYPE,
  type ThreadItem,
  type ThreadReactionResult,
  type ThreadReactor,
  type ThreadReactorParams,
  type ThreadStreamChunkType,
} from "@ekairos/thread"
import type { ThreadEnvironment } from "@ekairos/thread/runtime"

import { asRecord, asString, buildCodexParts, defaultInstructionFromTrigger, type AnyRecord } from "./shared.js"

export type CodexConfig = {
  appServerUrl: string
  repoPath: string
  threadId?: string
  mode?: "local" | "remote" | "sandbox"
  model?: string
  approvalPolicy?: string
  sandboxPolicy?: Record<string, unknown>
}

export type CodexTurnResult = {
  threadId: string
  turnId: string
  assistantText: string
  reasoningText?: string
  diff?: string
  toolParts?: unknown[]
  metadata?: Record<string, unknown>
  usage?: Record<string, unknown>
}

export type CodexExecuteTurnArgs<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  env: Env
  context: AnyRecord
  triggerEvent: ThreadItem
  contextId: string
  eventId: string
  executionId: string
  stepId: string
  iteration: number
  instruction: string
  config: Config
  writable: WritableStream<unknown>
  silent: boolean
  emitChunk: (providerChunk: unknown) => Promise<void>
}

export type CodexChunkMappingResult = {
  chunkType: ThreadStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
  skip?: boolean
}

export type CodexMappedChunk = {
  at: string
  sequence: number
  chunkType: ThreadStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

export type CodexStreamTrace = {
  totalChunks: number
  chunkTypes: Record<string, number>
  providerChunkTypes: Record<string, number>
  chunks?: CodexMappedChunk[]
}

export type CreateCodexReactorOptions<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  toolName?: string
  includeReasoningPart?: boolean
  buildInstruction?: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ThreadItem
  }) => string | Promise<string>
  resolveConfig: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ThreadItem
    contextId: string
    eventId: string
    executionId: string
    stepId: string
    iteration: number
  }) => Promise<Config>
  executeTurn: (
    args: CodexExecuteTurnArgs<Context, Config, Env>,
  ) => Promise<CodexTurnResult>
  mapChunk?: (providerChunk: unknown) => CodexChunkMappingResult | null
  includeStreamTraceInOutput?: boolean
  includeRawProviderChunksInOutput?: boolean
  maxPersistedStreamChunks?: number
  onMappedChunk?: (
    chunk: CodexMappedChunk,
    params: ThreadReactorParams<Context, Env>,
  ) => Promise<void> | void
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

export function mapCodexChunkType(providerChunkType: string): ThreadStreamChunkType {
  const value = providerChunkType.toLowerCase()

  if (value.includes("start_step")) return "chunk.start_step"
  if (value === "start") return "chunk.start"
  if (value.includes("finish_step")) return "chunk.finish_step"
  if (value === "finish") return "chunk.finish"

  if (value.includes("reasoning_start")) return "chunk.reasoning_start"
  if (value.includes("reasoning_delta")) return "chunk.reasoning_delta"
  if (value.includes("reasoning_end")) return "chunk.reasoning_end"

  if (value.includes("action_input_start") || value.includes("tool_input_start")) {
    return "chunk.action_input_start"
  }
  if (value.includes("action_input_delta") || value.includes("tool_input_delta")) {
    return "chunk.action_input_delta"
  }
  if (
    value.includes("action_input_available") ||
    value.includes("tool_input_available") ||
    value.includes("action_call")
  ) {
    return "chunk.action_input_available"
  }
  if (value.includes("action_output_available") || value.includes("tool_output_available")) {
    return "chunk.action_output_available"
  }
  if (value.includes("action_output_error") || value.includes("tool_output_error")) {
    return "chunk.action_output_error"
  }

  if (value.includes("message_metadata")) return "chunk.message_metadata"
  if (value.includes("response_metadata")) return "chunk.response_metadata"

  if (value.includes("text_start")) return "chunk.text_start"
  if (value.includes("text_delta") || (value.includes("message") && value.includes("delta"))) {
    return "chunk.text_delta"
  }
  if (value.includes("text_end")) return "chunk.text_end"

  if (value.includes("source_url")) return "chunk.source_url"
  if (value.includes("source_document")) return "chunk.source_document"
  if (value.includes("file")) return "chunk.file"
  if (value.includes("error")) return "chunk.error"
  return "chunk.unknown"
}

function normalizeLower(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

function isActionItemType(itemType: string): boolean {
  if (!itemType) return false
  if (itemType === "agentmessage") return false
  if (itemType === "reasoning") return false
  if (itemType === "usermessage") return false
  return (
    itemType.includes("commandexecution") ||
    itemType.includes("filechange") ||
    itemType.includes("mcptoolcall") ||
    itemType.includes("tool") ||
    itemType.includes("action")
  )
}

function resolveActionRef(params: AnyRecord, item: AnyRecord): string | undefined {
  const fromParams =
    asString(params.itemId) ||
    asString(params.toolCallId) ||
    asString(params.id)
  if (fromParams) return fromParams
  const fromItem = asString(item.id) || asString(item.toolCallId)
  if (fromItem) return fromItem
  return undefined
}

export function mapCodexAppServerNotification(
  providerChunk: unknown,
): CodexChunkMappingResult | null {
  const chunk = asRecord(providerChunk)
  const method = asString(chunk.method).trim()
  if (!method) return null

  if (method.startsWith("codex/event/")) {
    return {
      chunkType: "chunk.unknown",
      providerChunkType: method,
      data: toJsonSafe({
        ignored: true,
        reason: "legacy_channel_disabled",
        method,
      }),
      raw: toJsonSafe(providerChunk),
      skip: true,
    }
  }

  const params = asRecord(chunk.params)
  const item = asRecord(params.item)
  const itemType = normalizeLower(item.type)
  const itemStatus = normalizeLower(item.status)
  const actionRef = resolveActionRef(params, item)
  const hasItemError = Boolean(item.error)

  const mappedData = toJsonSafe({
    method,
    params,
  })

  const map = (chunkType: ThreadStreamChunkType): CodexChunkMappingResult => ({
    chunkType,
    providerChunkType: method,
    actionRef: chunkType.startsWith("chunk.action_") ? actionRef : undefined,
    data: mappedData,
    raw: toJsonSafe(providerChunk),
  })

  switch (method) {
    case "turn/started":
      return map("chunk.start")
    case "turn/completed":
      return map("chunk.finish")
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "thread/tokenUsage/updated":
    case "account/rateLimits/updated":
      return map("chunk.response_metadata")
    case "thread/started":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/name/updated":
    case "account/updated":
    case "app/list/updated":
    case "authStatusChange":
    case "sessionConfigured":
    case "loginChatGptComplete":
    case "mcpServer/oauthLogin/completed":
      return map("chunk.message_metadata")
    case "item/agentMessage/delta":
      return map("chunk.text_delta")
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return map("chunk.reasoning_delta")
    case "item/reasoning/summaryPartAdded":
      return map("chunk.reasoning_start")
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress":
      return map("chunk.action_output_available")
    case "item/started": {
      if (itemType === "agentmessage") return map("chunk.text_start")
      if (itemType === "reasoning") return map("chunk.reasoning_start")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) return map("chunk.action_input_available")
      return map("chunk.message_metadata")
    }
    case "item/completed": {
      if (itemType === "agentmessage") return map("chunk.text_end")
      if (itemType === "reasoning") return map("chunk.reasoning_end")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) {
        if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
          return map("chunk.action_output_error")
        }
        return map("chunk.action_output_available")
      }
      if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
        return map("chunk.error")
      }
      return map("chunk.message_metadata")
    }
    case "error":
      return map("chunk.error")
    default:
      if (method.startsWith("item/") || method.startsWith("turn/")) {
        return map("chunk.response_metadata")
      }
      if (method.startsWith("thread/") || method.startsWith("account/")) {
        return map("chunk.message_metadata")
      }
      return map("chunk.unknown")
  }
}

export function defaultMapCodexChunk(providerChunk: unknown): CodexChunkMappingResult {
  const appServerMapped = mapCodexAppServerNotification(providerChunk)
  if (appServerMapped) {
    return appServerMapped
  }

  const chunk = asRecord(providerChunk)
  const providerChunkType = asString(chunk.type) || "unknown"
  const actionRef = asString(chunk.actionRef) || asString(chunk.toolCallId) || asString(chunk.id) || undefined

  return {
    chunkType: mapCodexChunkType(providerChunkType),
    providerChunkType,
    actionRef,
    data: toJsonSafe({
      id: chunk.id,
      delta: chunk.delta,
      text: chunk.text,
      finishReason: chunk.finishReason,
      actionName: chunk.actionName,
      toolName: chunk.toolName,
      toolCallId: chunk.toolCallId,
    }),
    raw: toJsonSafe(providerChunk),
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return n
}

function getNestedRecord(source: unknown, key: string): AnyRecord | undefined {
  const record = asRecord(source)
  const nested = record[key]
  if (!nested || typeof nested !== "object") return undefined
  return asRecord(nested)
}

function extractUsageMetrics(usageSource: unknown) {
  const usage = asRecord(usageSource)
  const promptTokens =
    asFiniteNumber(usage.promptTokens) ??
    asFiniteNumber(usage.prompt_tokens) ??
    asFiniteNumber(usage.inputTokens) ??
    asFiniteNumber(usage.input_tokens) ??
    0

  const completionTokens =
    asFiniteNumber(usage.completionTokens) ??
    asFiniteNumber(usage.completion_tokens) ??
    asFiniteNumber(usage.outputTokens) ??
    asFiniteNumber(usage.output_tokens) ??
    0

  const totalTokens =
    asFiniteNumber(usage.totalTokens) ??
    asFiniteNumber(usage.total_tokens) ??
    promptTokens + completionTokens

  const promptDetails = getNestedRecord(usage, "prompt_tokens_details")
  const inputDetails = getNestedRecord(usage, "input_tokens_details")
  const cachedPromptTokens =
    asFiniteNumber(usage.promptTokensCached) ??
    asFiniteNumber(usage.cached_prompt_tokens) ??
    asFiniteNumber(promptDetails?.cached_tokens) ??
    asFiniteNumber(inputDetails?.cached_tokens) ??
    0

  const promptTokensUncached = Math.max(0, promptTokens - cachedPromptTokens)

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptTokensCached: cachedPromptTokens,
    promptTokensUncached,
  }
}

/**
 * Codex App Server reactor for @ekairos/thread.
 *
 * This maps one Thread loop iteration to one Codex turn and returns a persisted
 * assistant event compatible with the Thread engine.
 *
 * Workflow compatibility:
 * - `resolveConfig` and `executeTurn` should be implemented with `"use step"`
 *   wrappers when they perform I/O.
 */
export function createCodexReactor<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ThreadEnvironment = ThreadEnvironment,
>( 
  options: CreateCodexReactorOptions<Context, Config, Env>,
): ThreadReactor<Context, Env> {
  const toolName = asString(options.toolName).trim() || "codex"
  const includeReasoningPart = Boolean(options.includeReasoningPart)
  const includeStreamTraceInOutput =
    options.includeStreamTraceInOutput !== undefined
      ? Boolean(options.includeStreamTraceInOutput)
      : true
  const includeRawProviderChunksInOutput = Boolean(options.includeRawProviderChunksInOutput)
  const maxPersistedStreamChunks = Math.max(0, Number(options.maxPersistedStreamChunks ?? 300))

  return async (
    params: ThreadReactorParams<Context, Env>,
  ): Promise<ThreadReactionResult> => {
    let chunkSequence = 0
    const chunkTypeCounters = new Map<string, number>()
    const providerChunkTypeCounters = new Map<string, number>()
    const capturedChunks: CodexMappedChunk[] = []

    const context = asRecord(params.context.content)
    const instruction = (
      options.buildInstruction
        ? await options.buildInstruction({
            env: params.env,
            context,
            triggerEvent: params.triggerEvent,
          })
        : defaultInstructionFromTrigger(params.triggerEvent)
    ).trim()

    const config = await options.resolveConfig({
      env: params.env,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      eventId: params.eventId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
    })

    const startedAtMs = Date.now()

    const emitChunk = async (providerChunk: unknown) => {
      if (params.silent) return
      const mapped = options.mapChunk
        ? options.mapChunk(providerChunk)
        : defaultMapCodexChunk(providerChunk)
      if (!mapped || mapped.skip) return
      const now = new Date().toISOString()
      chunkSequence += 1

      const mappedChunk: CodexMappedChunk = {
        at: now,
        sequence: chunkSequence,
        chunkType: mapped.chunkType,
        providerChunkType: mapped.providerChunkType,
        actionRef: mapped.actionRef,
        data: mapped.data,
        raw: includeRawProviderChunksInOutput
          ? mapped.raw ?? toJsonSafe(providerChunk)
          : undefined,
      }

      chunkTypeCounters.set(
        mapped.chunkType,
        (chunkTypeCounters.get(mapped.chunkType) ?? 0) + 1,
      )
      const providerType = mapped.providerChunkType || "unknown"
      providerChunkTypeCounters.set(
        providerType,
        (providerChunkTypeCounters.get(providerType) ?? 0) + 1,
      )
      if (includeStreamTraceInOutput && capturedChunks.length < maxPersistedStreamChunks) {
        capturedChunks.push(mappedChunk)
      }

      if (options.onMappedChunk) {
        try {
          await options.onMappedChunk(mappedChunk, params)
        } catch {
          // hooks are non-critical
        }
      }

      const payload = {
        type: "chunk.emitted",
        at: now,
        chunkType: mappedChunk.chunkType,
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: params.stepId,
        itemId: params.eventId,
        actionRef: mappedChunk.actionRef,
        provider: "codex",
        providerChunkType: mappedChunk.providerChunkType,
        sequence: mappedChunk.sequence,
        data: mappedChunk.data,
        raw: mappedChunk.raw ?? mapped.raw ?? toJsonSafe(providerChunk),
      }

      const writer = params.writable.getWriter()
      try {
        await writer.write({
          type: "data-chunk.emitted",
          data: payload,
        })
      } finally {
        writer.releaseLock()
      }
    }

    const turn = await options.executeTurn({
      env: params.env,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      eventId: params.eventId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
      instruction,
      config,
      writable: params.writable,
      silent: params.silent,
      emitChunk,
    })
    const finishedAtMs = Date.now()

    const streamTrace: CodexStreamTrace | undefined = includeStreamTraceInOutput
      ? {
          totalChunks: chunkSequence,
          chunkTypes: Object.fromEntries(chunkTypeCounters.entries()),
          providerChunkTypes: Object.fromEntries(providerChunkTypeCounters.entries()),
          chunks: capturedChunks,
        }
      : undefined

    const usagePayload = toJsonSafe(turn.usage ?? asRecord(turn.metadata).usage)
    const usageMetrics = extractUsageMetrics(usagePayload)

    const assistantEvent: ThreadItem = {
      id: params.eventId,
      type: OUTPUT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: buildCodexParts({
          toolName,
          includeReasoningPart,
          result: turn,
          instruction,
          streamTrace,
        }),
      },
    }

    return {
      assistantEvent,
      actionRequests: [],
      messagesForModel: [],
      llm: {
        provider: "codex",
        model: asString(config.model || "codex"),
        promptTokens: usageMetrics.promptTokens,
        promptTokensCached: usageMetrics.promptTokensCached,
        promptTokensUncached: usageMetrics.promptTokensUncached,
        completionTokens: usageMetrics.completionTokens,
        totalTokens: usageMetrics.totalTokens,
        latencyMs: Math.max(0, finishedAtMs - startedAtMs),
        rawUsage: usagePayload,
        rawProviderMetadata: toJsonSafe({
          threadId: turn.threadId,
          turnId: turn.turnId,
          metadata: turn.metadata ?? null,
          streamTrace: streamTrace
            ? {
                totalChunks: streamTrace.totalChunks,
                chunkTypes: streamTrace.chunkTypes,
                providerChunkTypes: streamTrace.providerChunkTypes,
              }
            : undefined,
        }),
      },
    }
  }
}
