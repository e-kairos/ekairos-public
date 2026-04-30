import {
  OUTPUT_ITEM_TYPE,
  actionsToActionSpecs,
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
  resolveContextPartChunkIdentity,
  type ChunkEmittedEvent,
  type ContextActionRequest,
  type ContextItem,
  type ContextReactionResult,
  type ContextReactor,
  type ContextReactorParams,
  type ContextStreamChunkType,
} from "@ekairos/events"
import type { ContextEnvironment } from "@ekairos/events/runtime"

export type OpenAIResponsesConfig = {
  model: string
  url?: string
  baseUrl?: string
  webSocketUrl?: string
  headers?: Record<string, string>
  headersFromEnv?: {
    authorizationBearerEnv?: string
    apiKeyEnv?: string
  }
  requestDefaults?: Record<string, unknown>
  providerName?: string
  reuseHotConnection?: boolean
  usePreviousResponseId?: boolean
  idleTtlMs?: number
  maxHotConnections?: number
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  strictJsonSchema?: boolean
}

type ResponsesActionSpec = {
  type?: "function" | "provider-defined"
  id?: string
  name?: string
  description?: string
  inputSchema?: unknown
  args?: Record<string, unknown>
}

export type OpenAIResponsesMappedChunk = {
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  providerChunkType?: string
  providerPartId?: string
  partId?: string
  partType?: string
  partSlot?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

export type OpenAIResponsesStreamTrace = {
  totalChunks: number
  chunkTypes: Record<string, number>
  providerChunkTypes: Record<string, number>
  chunks?: OpenAIResponsesMappedChunk[]
}

export type OpenAIResponsesReactionStepArgs<
  Config extends OpenAIResponsesConfig = OpenAIResponsesConfig,
> = {
  config: Config
  systemPrompt?: string
  events: ContextItem[]
  triggerEvent: ContextItem
  eventId: string
  executionId: string
  contextId: string
  stepId: string
  iteration: number
  maxModelSteps: number
  actionSpecs: Record<string, ResponsesActionSpec>
  previousReactorState?: Record<string, unknown>
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<unknown>
  silent: boolean
  includeStreamTraceInOutput?: boolean
  includeRawProviderEventsInOutput?: boolean
  maxPersistedStreamEvents?: number
}

export type CreateOpenAIResponsesReactorOptions<
  Context,
  Config extends OpenAIResponsesConfig = OpenAIResponsesConfig,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  resolveConfig: (params: {
    runtime: ContextReactorParams<Context, Env>["runtime"]
    context: Record<string, unknown>
    triggerEvent: ContextItem
    contextId: string
    eventId: string
    executionId: string
    stepId: string
    iteration: number
  }) => Promise<Config> | Config
  includeStreamTraceInOutput?: boolean
  includeRawProviderEventsInOutput?: boolean
  maxPersistedStreamEvents?: number
}

type AnyRecord = Record<string, unknown>

type ResponsesInputItem = Record<string, unknown>

type BuildResponsesInputResult = {
  input: ResponsesInputItem[]
  previousResponseId?: string
  usedPreviousResponseId: boolean
  replayed: boolean
}

type FunctionCallState = {
  itemId?: string
  callId: string
  name: string
  argumentsText: string
  outputIndex?: number
}

type StepState = {
  assistantTextByItemId: Map<string, string>
  reasoningTextByPartId: Map<string, string>
  functionCallsByCallId: Map<string, FunctionCallState>
  callIdByOutputIndex: Map<number, string>
  textStarted: Set<string>
  textEnded: Set<string>
  reasoningStarted: Set<string>
  reasoningEnded: Set<string>
  response: AnyRecord
  usage?: AnyRecord
  finishReason?: string
  responseId?: string
  model?: string
  finalMetrics?: unknown
}

const DEFAULT_PROVIDER = "openai-responses"
const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const TOOL_DESCRIPTION_MAX_LENGTH = 1_200
const SCHEMA_DESCRIPTION_MAX_LENGTH = 240
const DROPPED_JSON_SCHEMA_METADATA_KEYS = new Set([
  "$schema",
  "$id",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
])

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  return String(value)
}

function readEnvString(name: unknown): string {
  const key = asString(name).trim()
  if (!key) return ""
  return asString(process.env[key]).trim()
}

function cleanRecord<T extends AnyRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function compactDescription(value: unknown, maxLength: number): string | undefined {
  const text = asString(value).replace(/\s+/g, " ").trim()
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "undefined") return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function compactResponsesJsonSchema(value: unknown): unknown {
  const safe = toJsonSafe(value)
  if (safe === undefined) return undefined
  return compactResponsesJsonSchemaValue(safe)
}

function compactResponsesJsonSchemaValue(value: unknown, containerKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compactResponsesJsonSchemaValue(entry, containerKey))
  }
  if (!value || typeof value !== "object") return value

  const isNamedSchemaMap =
    containerKey === "properties" || containerKey === "$defs" || containerKey === "definitions"
  const out: AnyRecord = {}
  for (const [key, entry] of Object.entries(value as AnyRecord)) {
    if (!isNamedSchemaMap && DROPPED_JSON_SCHEMA_METADATA_KEYS.has(key)) continue
    if (isNamedSchemaMap) {
      out[key] = compactResponsesJsonSchemaValue(entry, key)
      continue
    }
    if (key === "description") {
      const description = compactDescription(entry, SCHEMA_DESCRIPTION_MAX_LENGTH)
      if (description) out[key] = description
      continue
    }
    if (key === "title") {
      const title = compactDescription(entry, SCHEMA_DESCRIPTION_MAX_LENGTH)
      if (title) out[key] = title
      continue
    }
    out[key] = compactResponsesJsonSchemaValue(entry, key)
  }
  return out
}

function sanitizeRaw(value: unknown): unknown {
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(
      JSON.stringify(value, (key, entry) => {
        if (/token|authorization|cookie|secret|api[_-]?key|password/i.test(key)) {
          return "[redacted]"
        }
        if (typeof entry === "string" && entry.length > 20_000) {
          return "[truncated-string]"
        }
        if (entry && typeof entry === "object") {
          if (seen.has(entry)) return "[circular]"
          seen.add(entry)
        }
        return entry
      }),
    )
  } catch {
    return undefined
  }
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asString(entry).trim())
    .filter(Boolean)
}

function parseJsonObject(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(toJsonSafe(value) ?? value)
  } catch {
    return String(value)
  }
}

function partText(part: unknown): string {
  const record = asRecord(part)
  const type = asString(record.type)
  if (type === "message") {
    const content = asRecord(record.content)
    const text = asString(content.text)
    const blocks = asArray(content.blocks)
      .map((block) => {
        const blockRecord = asRecord(block)
        if (asString(blockRecord.type) === "text") return asString(blockRecord.text)
        if (asString(blockRecord.type) === "json") return JSON.stringify(blockRecord.value)
        return ""
      })
      .filter(Boolean)
      .join("\n")
    return [text, blocks].filter(Boolean).join("\n").trim()
  }
  if (type === "text" || type === "input_text") {
    return asString(record.text || record.input_text).trim()
  }
  return asString(record.text).trim()
}

function eventText(event: ContextItem): string {
  return asArray(event.content?.parts).map(partText).filter(Boolean).join("\n").trim()
}

function roleForEvent(event: ContextItem): "user" | "assistant" {
  return event.type === OUTPUT_ITEM_TYPE ? "assistant" : "user"
}

function normalizeContentText(text: string, role: "user" | "assistant") {
  if (role === "assistant") {
    return [{ type: "output_text", text }]
  }
  return [{ type: "input_text", text }]
}

function actionPartContent(part: unknown): AnyRecord {
  const record = asRecord(part)
  return asRecord(record.content)
}

function actionResultRef(part: unknown): string {
  const content = actionPartContent(part)
  const status = asString(content.status)
  if (status !== "completed" && status !== "failed") return ""
  return asString(content.actionCallId)
}

function collectActionResultRefs(events: readonly ContextItem[]): string[] {
  const refs = new Set<string>()
  for (const event of events) {
    for (const part of asArray(event.content?.parts)) {
      const ref = actionResultRef(part)
      if (ref) refs.add(ref)
    }
  }
  return [...refs]
}

function actionPartsToResponsesInput(params: {
  parts: unknown[]
  onlyResultRefs?: Set<string>
}): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = []
  for (const part of params.parts) {
    const record = asRecord(part)
    const type = asString(record.type)
    if (type === "action") {
      const content = asRecord(record.content)
      const status = asString(content.status)
      const actionCallId = asString(content.actionCallId)
      const actionName = asString(content.actionName)
      if (!actionCallId || !actionName) continue

      if (status === "started" && !params.onlyResultRefs) {
        out.push({
          type: "function_call",
          call_id: actionCallId,
          name: actionName,
          arguments: JSON.stringify(content.input ?? {}),
        })
        continue
      }

      if (status === "completed" || status === "failed") {
        if (params.onlyResultRefs && !params.onlyResultRefs.has(actionCallId)) {
          continue
        }
        out.push({
          type: "function_call_output",
          call_id: actionCallId,
          output:
            status === "failed"
              ? stringifyToolOutput(asRecord(content.error).message || content.error)
              : stringifyToolOutput(content.output),
        })
      }
      continue
    }

    if (type.startsWith("tool-")) {
      const toolName = type.slice("tool-".length)
      const toolCallId = asString(record.toolCallId)
      const state = asString(record.state)
      if (!toolName || !toolCallId) continue
      if (state === "input-available" && !params.onlyResultRefs) {
        out.push({
          type: "function_call",
          call_id: toolCallId,
          name: toolName,
          arguments: JSON.stringify(record.input ?? {}),
        })
        continue
      }
      if (state === "output-available" || state === "output-error") {
        if (params.onlyResultRefs && !params.onlyResultRefs.has(toolCallId)) {
          continue
        }
        out.push({
          type: "function_call_output",
          call_id: toolCallId,
          output:
            state === "output-error"
              ? stringifyToolOutput(record.errorText || "Action execution failed.")
              : stringifyToolOutput(record.output),
        })
      }
    }
  }
  return out
}

function itemToResponsesInput(event: ContextItem): ResponsesInputItem[] {
  const role = roleForEvent(event)
  const parts = asArray(event.content?.parts)
  const input: ResponsesInputItem[] = []
  const text = eventText(event)
  if (text) {
    input.push({
      role,
      content: normalizeContentText(text, role),
    })
  }
  if (role === "assistant") {
    input.push(...actionPartsToResponsesInput({ parts }))
  }
  return input
}

function buildResponsesInput(params: {
  events: ContextItem[]
  triggerEvent: ContextItem
  previousState?: Record<string, unknown>
  usePreviousResponseId: boolean
}): BuildResponsesInputResult {
  const previousResponseId = asString(params.previousState?.responseId)
  const seenItemIds = new Set(asStringArray(params.previousState?.seenItemIds))
  const seenActionResultRefs = new Set(asStringArray(params.previousState?.seenActionResultRefs))

  if (params.usePreviousResponseId && previousResponseId && seenItemIds.size > 0) {
    const incremental: ResponsesInputItem[] = []
    for (const event of params.events) {
      if (!seenItemIds.has(event.id)) {
        incremental.push(...itemToResponsesInput(event))
        continue
      }

      if (event.type !== OUTPUT_ITEM_TYPE) continue
      const newResultRefs = new Set<string>()
      for (const part of asArray(event.content?.parts)) {
        const ref = actionResultRef(part)
        if (ref && !seenActionResultRefs.has(ref)) newResultRefs.add(ref)
      }
      if (newResultRefs.size > 0) {
        incremental.push(
          ...actionPartsToResponsesInput({
            parts: asArray(event.content?.parts),
            onlyResultRefs: newResultRefs,
          }),
        )
      }
    }

    if (incremental.length > 0) {
      return {
        input: incremental,
        previousResponseId,
        usedPreviousResponseId: true,
        replayed: false,
      }
    }
  }

  let input = params.events.flatMap(itemToResponsesInput)
  if (input.length === 0) {
    input = itemToResponsesInput(params.triggerEvent)
  }
  return {
    input,
    usedPreviousResponseId: false,
    replayed: true,
  }
}

function buildMessagesForModel(input: ResponsesInputItem[]): ContextReactionResult["messagesForModel"] {
  return input
    .map((item) => {
      const role = asString(item.role)
      if (role === "user" || role === "assistant" || role === "system") {
        const content = asArray(item.content)
          .map((part) => {
            const record = asRecord(part)
            return asString(record.text || record.input_text)
          })
          .filter(Boolean)
          .join("\n")
        if (!content) return null
        return { role, content }
      }
      if (item.type === "function_call_output") {
        return {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: asString(item.call_id),
              toolName: "function",
              output: {
                type: "json",
                value: item.output,
              },
            },
          ],
        }
      }
      return null
    })
    .filter(Boolean) as ContextReactionResult["messagesForModel"]
}

export function resolveOpenAIResponsesWebSocketUrl(config: OpenAIResponsesConfig): string {
  const raw = asString(config.webSocketUrl || config.url || config.baseUrl || DEFAULT_BASE_URL).trim()
  if (!raw) throw new Error("openai_responses_websocket_url_required")

  const url = new URL(raw)
  if (url.protocol === "https:") url.protocol = "wss:"
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol !== "wss:") {
    throw new Error("openai_responses_websocket_url_must_use_wss")
  }

  const path = url.pathname.replace(/\/+$/, "")
  if (!path.endsWith("/responses")) {
    url.pathname = `${path || ""}/responses`
  }
  return url.toString()
}

export function resolveOpenAIResponsesHeaders(
  config: OpenAIResponsesConfig,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(config.headers ?? {}) }
  const apiKey = readEnvString(config.headersFromEnv?.apiKeyEnv)
  const bearer = readEnvString(config.headersFromEnv?.authorizationBearerEnv)

  if (apiKey && !headers["api-key"]) headers["api-key"] = apiKey
  if (bearer && !headers.Authorization) headers.Authorization = `Bearer ${bearer}`

  return Object.keys(headers).length > 0 ? headers : undefined
}

function buildResponsesTools(
  actionSpecs: Record<string, ResponsesActionSpec>,
  strictJsonSchema: boolean,
): AnyRecord[] {
  const tools: AnyRecord[] = []
  for (const [name, spec] of Object.entries(actionSpecs)) {
    const toolName = asString(name).trim()
    if (!toolName) continue

    if (spec.type === "provider-defined") {
      continue
    }

    tools.push(
      cleanRecord({
        type: "function",
        name: toolName,
        description: compactDescription(spec.description, TOOL_DESCRIPTION_MAX_LENGTH),
        parameters:
          compactResponsesJsonSchema(spec.inputSchema) ?? { type: "object", additionalProperties: true },
        strict: strictJsonSchema,
      }),
    )
  }
  return tools
}

function getNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function extractUsageMetrics(usageSource: unknown) {
  const usage = asRecord(usageSource)
  const inputDetails = asRecord(usage.input_tokens_details)
  const outputDetails = asRecord(usage.output_tokens_details)
  const promptTokens = getNumber(usage.promptTokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input_tokens)
  const completionTokens = getNumber(
    usage.completionTokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.output_tokens,
  )
  const totalTokens = getNumber(usage.totalTokens ?? usage.total_tokens) || promptTokens + completionTokens
  const promptTokensCached = getNumber(
    usage.promptTokensCached ?? usage.cached_prompt_tokens ?? inputDetails.cached_tokens,
  )

  return {
    promptTokens,
    promptTokensCached,
    promptTokensUncached: Math.max(0, promptTokens - promptTokensCached),
    completionTokens,
    totalTokens,
    reasoningTokens: getNumber(outputDetails.reasoning_tokens),
  }
}

function responseUsage(response: unknown): AnyRecord {
  return asRecord(asRecord(response).usage)
}

function responseIdFromEvent(event: unknown): string {
  const record = asRecord(event)
  return asString(asRecord(record.response).id || record.response_id || record.id)
}

function modelFromEvent(event: unknown): string {
  const record = asRecord(event)
  return asString(asRecord(record.response).model || record.model)
}

function providerEventType(event: unknown): string {
  return asString(asRecord(event).type) || "unknown"
}

function providerPartIdForEvent(event: unknown, state: StepState): string | undefined {
  const record = asRecord(event)
  const item = asRecord(record.item)
  const type = providerEventType(event)

  if (
    type === "response.function_call_arguments.delta" ||
    type === "response.function_call_arguments.done"
  ) {
    const outputIndex = typeof record.output_index === "number" ? record.output_index : undefined
    return outputIndex === undefined ? asString(record.item_id) : state.callIdByOutputIndex.get(outputIndex)
  }
  if (type.startsWith("response.reasoning_summary_")) {
    const itemId = asString(record.item_id)
    const summaryIndex = getNumber(record.summary_index)
    return itemId ? `${itemId}:${summaryIndex}` : undefined
  }
  if (item.type === "function_call") {
    return asString(item.call_id || item.id) || undefined
  }
  return asString(record.item_id || item.id || record.id) || undefined
}

function mapProviderEventType(event: unknown, state: StepState): ContextStreamChunkType {
  const record = asRecord(event)
  const item = asRecord(record.item)
  const type = providerEventType(event)

  if (type === "response.created" || type === "response.in_progress") {
    return "chunk.response_metadata"
  }
  if (type === "response.output_item.added") {
    if (item.type === "message") return "chunk.text_start"
    if (item.type === "reasoning") return "chunk.reasoning_start"
    if (item.type === "function_call") return "chunk.action_started"
    return "chunk.response_metadata"
  }
  if (type === "response.content_part.added") {
    return "chunk.text_start"
  }
  if (type === "response.output_text.delta") {
    return "chunk.text_delta"
  }
  if (type === "response.output_text.done" || type === "response.content_part.done") {
    return "chunk.text_end"
  }
  if (type === "response.output_item.done") {
    if (item.type === "message") return "chunk.text_end"
    if (item.type === "reasoning") return "chunk.reasoning_end"
    if (item.type === "function_call") return "chunk.action_started"
    return "chunk.response_metadata"
  }
  if (type === "response.function_call_arguments.delta") {
    return "chunk.action_input_delta"
  }
  if (type === "response.function_call_arguments.done") {
    return "chunk.action_started"
  }
  if (type === "response.reasoning_summary_part.added") {
    return "chunk.reasoning_start"
  }
  if (type === "response.reasoning_summary_text.delta") {
    return "chunk.reasoning_delta"
  }
  if (type === "response.reasoning_summary_part.done") {
    return "chunk.reasoning_end"
  }
  if (type === "response.completed" || type === "response.incomplete") {
    return "chunk.finish"
  }
  if (type === "response.failed" || type === "response.error" || type === "error") {
    return "chunk.error"
  }
  return state.responseId ? "chunk.response_metadata" : "chunk.unknown"
}

function normalizedEventData(event: unknown, state: StepState): AnyRecord {
  const record = asRecord(event)
  const item = asRecord(record.item)
  const response = asRecord(record.response)
  const type = providerEventType(event)
  const outputIndex = typeof record.output_index === "number" ? record.output_index : undefined
  const callId =
    asString(item.call_id) ||
    (outputIndex === undefined ? "" : asString(state.callIdByOutputIndex.get(outputIndex))) ||
    asString(record.call_id)

  return cleanRecord({
    type,
    id: asString(record.id || response.id || item.id) || undefined,
    itemId: asString(record.item_id || item.id) || undefined,
    responseId: asString(response.id || record.response_id || state.responseId) || undefined,
    outputIndex,
    delta: record.delta,
    text: record.text,
    actionName: asString(item.name || record.name) || undefined,
    toolName: asString(item.name || record.name) || undefined,
    toolCallId: callId || undefined,
    input: item.arguments ? parseJsonObject(asString(item.arguments)) : undefined,
    finishReason: asString(asRecord(response.incomplete_details).reason) || undefined,
    usage: response.usage,
    status: asString(response.status || item.status || record.status) || undefined,
    error: record.error,
  })
}

function updateStepStateFromEvent(event: unknown, state: StepState) {
  const record = asRecord(event)
  const item = asRecord(record.item)
  const response = asRecord(record.response)
  const type = providerEventType(event)

  const responseId = asString(response.id || record.response_id)
  if (responseId) state.responseId = responseId
  const model = asString(response.model || record.model)
  if (model) state.model = model
  if (Object.keys(response).length > 0) state.response = response
  if (response.usage) state.usage = asRecord(response.usage)

  if (type === "response.output_item.added" && item.type === "function_call") {
    const callId = asString(item.call_id || item.id)
    const outputIndex = typeof record.output_index === "number" ? record.output_index : undefined
    if (callId) {
      state.functionCallsByCallId.set(callId, {
        itemId: asString(item.id) || undefined,
        callId,
        name: asString(item.name),
        argumentsText: asString(item.arguments),
        outputIndex,
      })
      if (outputIndex !== undefined) state.callIdByOutputIndex.set(outputIndex, callId)
    }
  }

  if (type === "response.function_call_arguments.delta") {
    const outputIndex = typeof record.output_index === "number" ? record.output_index : undefined
    const callId = outputIndex === undefined ? "" : asString(state.callIdByOutputIndex.get(outputIndex))
    if (callId) {
      const current = state.functionCallsByCallId.get(callId)
      if (current) current.argumentsText += asString(record.delta)
    }
  }

  if (
    (type === "response.output_item.done" || type === "response.function_call_arguments.done") &&
    item.type === "function_call"
  ) {
    const callId = asString(item.call_id || item.id)
    if (callId) {
      state.functionCallsByCallId.set(callId, {
        itemId: asString(item.id) || undefined,
        callId,
        name: asString(item.name),
        argumentsText: asString(item.arguments),
        outputIndex: typeof record.output_index === "number" ? record.output_index : undefined,
      })
    }
  }

  if (type === "response.output_text.delta") {
    const itemId = asString(record.item_id)
    if (itemId) {
      state.assistantTextByItemId.set(
        itemId,
        `${state.assistantTextByItemId.get(itemId) ?? ""}${asString(record.delta)}`,
      )
    }
  }

  if (type === "response.output_text.done") {
    const itemId = asString(record.item_id)
    const text = asString(record.text)
    if (itemId && text) state.assistantTextByItemId.set(itemId, text)
  }

  if (type === "response.reasoning_summary_text.delta") {
    const itemId = asString(record.item_id)
    const summaryIndex = getNumber(record.summary_index)
    const partId = itemId ? `${itemId}:${summaryIndex}` : ""
    if (partId) {
      state.reasoningTextByPartId.set(
        partId,
        `${state.reasoningTextByPartId.get(partId) ?? ""}${asString(record.delta)}`,
      )
    }
  }
}

function mappedChunkFromEvent(params: {
  event: unknown
  sequence: number
  provider: string
  stepId: string
  includeRaw: boolean
  state: StepState
}): OpenAIResponsesMappedChunk {
  updateStepStateFromEvent(params.event, params.state)
  const providerPartId = providerPartIdForEvent(params.event, params.state)
  let chunkType = mapProviderEventType(params.event, params.state)
  if (providerPartId && chunkType === "chunk.text_start") {
    if (params.state.textStarted.has(providerPartId)) {
      chunkType = "chunk.response_metadata"
    } else {
      params.state.textStarted.add(providerPartId)
    }
  }
  if (providerPartId && chunkType === "chunk.text_end") {
    if (params.state.textEnded.has(providerPartId)) {
      chunkType = "chunk.response_metadata"
    } else {
      params.state.textEnded.add(providerPartId)
    }
  }
  if (providerPartId && chunkType === "chunk.reasoning_start") {
    if (params.state.reasoningStarted.has(providerPartId)) {
      chunkType = "chunk.response_metadata"
    } else {
      params.state.reasoningStarted.add(providerPartId)
    }
  }
  if (providerPartId && chunkType === "chunk.reasoning_end") {
    if (params.state.reasoningEnded.has(providerPartId)) {
      chunkType = "chunk.response_metadata"
    } else {
      params.state.reasoningEnded.add(providerPartId)
    }
  }
  const identity = resolveContextPartChunkIdentity({
    stepId: params.stepId,
    provider: params.provider,
    providerPartId,
    chunkType,
  })
  const actionRef = chunkType.startsWith("chunk.action_")
    ? identity?.providerPartId ?? providerPartId
    : undefined

  return {
    at: new Date().toISOString(),
    sequence: params.sequence,
    chunkType,
    providerChunkType: providerEventType(params.event),
    partId: identity?.partId,
    providerPartId: identity?.providerPartId,
    partType: identity?.partType,
    partSlot: identity?.partSlot,
    actionRef,
    data: toJsonSafe(normalizedEventData(params.event, params.state)),
    raw: params.includeRaw ? sanitizeRaw(params.event) : undefined,
  }
}

function createStepState(): StepState {
  return {
    assistantTextByItemId: new Map(),
    reasoningTextByPartId: new Map(),
    functionCallsByCallId: new Map(),
    callIdByOutputIndex: new Map(),
    textStarted: new Set(),
    textEnded: new Set(),
    reasoningStarted: new Set(),
    reasoningEnded: new Set(),
    response: {},
  }
}

function buildAssistantParts(params: {
  state: StepState
  provider: string
  executionId: string
  eventId: string
}) {
  const parts: AnyRecord[] = []
  for (const [itemId, text] of params.state.assistantTextByItemId.entries()) {
    const normalized = text.trim()
    if (!normalized) continue
    parts.push({
      type: "message",
      content: { text: normalized },
      reactorMetadata: cleanRecord({
        reactorKind: params.provider,
        executionId: params.executionId,
        itemId: params.eventId,
        provider: {
          openaiResponses: cleanRecord({
            responseId: params.state.responseId,
            itemId,
          }),
        },
      }),
    })
  }

  for (const [partId, text] of params.state.reasoningTextByPartId.entries()) {
    const normalized = text.trim()
    if (!normalized) continue
    parts.push({
      type: "reasoning",
      content: { text: normalized, state: "done" },
      reactorMetadata: cleanRecord({
        reactorKind: params.provider,
        executionId: params.executionId,
        itemId: params.eventId,
        provider: {
          openaiResponses: cleanRecord({
            responseId: params.state.responseId,
            itemId: partId,
          }),
        },
      }),
    })
  }

  for (const call of params.state.functionCallsByCallId.values()) {
    if (!call.callId || !call.name) continue
    parts.push({
      type: "action",
      content: {
        status: "started",
        actionName: call.name,
        actionCallId: call.callId,
        input: parseJsonObject(call.argumentsText),
      },
      reactorMetadata: cleanRecord({
        reactorKind: params.provider,
        executionId: params.executionId,
        itemId: params.eventId,
        actionCallId: call.callId,
        provider: {
          openaiResponses: cleanRecord({
            responseId: params.state.responseId,
            itemId: call.itemId,
          }),
        },
      }),
    })
  }
  return parts
}

function buildActionRequests(state: StepState): ContextActionRequest[] {
  return [...state.functionCallsByCallId.values()]
    .filter((call) => call.callId && call.name)
    .map((call) => ({
      actionRef: call.callId,
      actionName: call.name,
      input: parseJsonObject(call.argumentsText),
    }))
}

function buildStreamTrace(params: {
  mappedChunks: OpenAIResponsesMappedChunk[]
  chunkTypeCounters: Map<string, number>
  providerChunkTypeCounters: Map<string, number>
  includeChunks: boolean
}): OpenAIResponsesStreamTrace {
  return cleanRecord({
    totalChunks: params.mappedChunks.length,
    chunkTypes: Object.fromEntries(params.chunkTypeCounters.entries()),
    providerChunkTypes: Object.fromEntries(params.providerChunkTypeCounters.entries()),
    chunks: params.includeChunks ? params.mappedChunks : undefined,
  })
}

export async function executeOpenAIResponsesReactionStep<
  Config extends OpenAIResponsesConfig = OpenAIResponsesConfig,
>(args: OpenAIResponsesReactionStepArgs<Config>): Promise<ContextReactionResult> {
  "use step"

  const { streamOpenAIResponsesWebSocket } = await import("./responses.websocket.js")

  const provider = asString(args.config.providerName).trim() || DEFAULT_PROVIDER
  const includeStreamTraceInOutput = args.includeStreamTraceInOutput !== false
  const includeRawProviderEventsInOutput = Boolean(args.includeRawProviderEventsInOutput)
  const maxPersistedStreamEvents = Math.max(0, Number(args.maxPersistedStreamEvents ?? 300))
  const state = createStepState()
  const contextWriter = args.contextStepStream?.getWriter()
  const workflowWriter = args.writable?.getWriter()
  const mappedChunks: OpenAIResponsesMappedChunk[] = []
  const persistedChunks: OpenAIResponsesMappedChunk[] = []
  const chunkTypeCounters = new Map<string, number>()
  const providerChunkTypeCounters = new Map<string, number>()
  const startedAtMs = Date.now()
  let sequence = 0

  const inputBuild = buildResponsesInput({
    events: args.events,
    triggerEvent: args.triggerEvent,
    previousState: args.previousReactorState,
    usePreviousResponseId: args.config.usePreviousResponseId !== false,
  })
  const messagesForModel = buildMessagesForModel(inputBuild.input)

  const requestDefaults = asRecord(args.config.requestDefaults)
  const requestTools = asArray<AnyRecord>(requestDefaults.tools)
  const actionTools = buildResponsesTools(args.actionSpecs, Boolean(args.config.strictJsonSchema))
  const tools = [...requestTools, ...actionTools]
  const request = cleanRecord({
    ...requestDefaults,
    model: args.config.model,
    input: inputBuild.input,
    instructions:
      requestDefaults.instructions === undefined
        ? asString(args.systemPrompt).trim() || undefined
        : requestDefaults.instructions,
    previous_response_id:
      requestDefaults.previous_response_id === undefined
        ? inputBuild.previousResponseId
        : requestDefaults.previous_response_id,
    tools: tools.length > 0 ? tools : undefined,
  })

  async function emitMappedChunk(mapped: OpenAIResponsesMappedChunk) {
    mappedChunks.push(mapped)
    if (includeStreamTraceInOutput && persistedChunks.length < maxPersistedStreamEvents) {
      persistedChunks.push(mapped)
    }
    chunkTypeCounters.set(mapped.chunkType, (chunkTypeCounters.get(mapped.chunkType) ?? 0) + 1)
    const providerType = mapped.providerChunkType || "unknown"
    providerChunkTypeCounters.set(providerType, (providerChunkTypeCounters.get(providerType) ?? 0) + 1)

    const payload = {
      at: mapped.at,
      sequence: mapped.sequence,
      chunkType: mapped.chunkType,
      provider,
      providerChunkType: mapped.providerChunkType,
      partId: mapped.partId,
      providerPartId: mapped.providerPartId,
      partType: mapped.partType,
      partSlot: mapped.partSlot,
      actionRef: mapped.actionRef,
      data: mapped.data,
      raw: mapped.raw,
    }

    await contextWriter?.write(
      encodeContextStepStreamChunk(
        createContextStepStreamChunk({
          ...payload,
          stepId: args.stepId,
        }),
      ),
    )

    const event: ChunkEmittedEvent = {
      type: "chunk.emitted",
      contextId: args.contextId,
      executionId: args.executionId,
      stepId: args.stepId,
      itemId: args.eventId,
      ...payload,
    }
    await workflowWriter?.write({
      type: "data-chunk.emitted",
      data: event,
    })
  }

  let finalMetrics: import("./responses.websocket.js").OpenAIResponsesStreamMetrics | undefined
  try {
    finalMetrics = await streamOpenAIResponsesWebSocket({
      webSocketUrl: resolveOpenAIResponsesWebSocketUrl(args.config),
      headers: resolveOpenAIResponsesHeaders(args.config),
      handshakeTimeoutMs: args.config.handshakeTimeoutMs,
      requestTimeoutMs: args.config.requestTimeoutMs,
      reuseHotConnection: args.config.reuseHotConnection,
      idleTtlMs: args.config.idleTtlMs,
      maxHotConnections: args.config.maxHotConnections,
      request,
      onEvent: async (event, metrics) => {
        state.finalMetrics = metrics
        sequence += 1
        await emitMappedChunk(
          mappedChunkFromEvent({
            event,
            sequence,
            provider,
            stepId: args.stepId,
            includeRaw: includeRawProviderEventsInOutput,
            state,
          }),
        )
      },
    })
    state.finalMetrics = finalMetrics
  } finally {
    contextWriter?.releaseLock()
    workflowWriter?.releaseLock()
  }

  const finishedAtMs = Date.now()
  const connectionMode = finalMetrics?.connectionMode ?? "cold"
  const usageMetrics = extractUsageMetrics(state.usage)
  const parts = buildAssistantParts({
    state,
    provider,
    executionId: args.executionId,
    eventId: args.eventId,
  })
  const actionRequests = buildActionRequests(state)
  const streamTrace = buildStreamTrace({
    mappedChunks: persistedChunks,
    chunkTypeCounters,
    providerChunkTypeCounters,
    includeChunks: includeStreamTraceInOutput,
  })

  const assistantEvent: ContextItem = {
    id: args.eventId,
    type: OUTPUT_ITEM_TYPE,
    channel: "web",
    createdAt: new Date().toISOString(),
    status: "completed",
    content: { parts },
  }

  const seenItemIds = new Set([
    ...args.events.map((event) => event.id).filter(Boolean),
    args.eventId,
  ])
  const seenActionResultRefs = new Set(collectActionResultRefs(args.events))

  return {
    assistantEvent,
    actionRequests,
    messagesForModel,
    llm: {
      provider,
      model: state.model || args.config.model,
      promptTokens: usageMetrics.promptTokens,
      promptTokensCached: usageMetrics.promptTokensCached,
      promptTokensUncached: usageMetrics.promptTokensUncached,
      completionTokens: usageMetrics.completionTokens,
      totalTokens: usageMetrics.totalTokens,
      latencyMs: Math.max(0, finishedAtMs - startedAtMs),
      rawUsage: toJsonSafe(state.usage),
      rawProviderMetadata: toJsonSafe({
        responseId: state.responseId,
        response: state.response,
        streamTrace,
        transport: finalMetrics
          ? {
              ...finalMetrics,
              connectionMode,
            }
          : undefined,
        input: {
          usedPreviousResponseId: inputBuild.usedPreviousResponseId,
          replayed: inputBuild.replayed,
          itemCount: inputBuild.input.length,
        },
      }),
    },
    reactor: {
      kind: provider,
      state: {
        responseId: state.responseId,
        model: state.model || args.config.model,
        connectionMode,
        transportCacheKey: finalMetrics?.cacheKey,
        lastMetrics: finalMetrics,
        usedPreviousResponseId: inputBuild.usedPreviousResponseId,
        replayedInput: inputBuild.replayed,
        seenItemIds: [...seenItemIds],
        seenActionResultRefs: [...seenActionResultRefs],
      },
    },
  }
}

export function createOpenAIResponsesReactor<
  Context,
  Config extends OpenAIResponsesConfig = OpenAIResponsesConfig,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  options: CreateOpenAIResponsesReactorOptions<Context, Config, Env>,
): ContextReactor<Context, Env> {
  const includeStreamTraceInOutput = options.includeStreamTraceInOutput !== false
  const includeRawProviderEventsInOutput = Boolean(options.includeRawProviderEventsInOutput)
  const maxPersistedStreamEvents = Math.max(0, Number(options.maxPersistedStreamEvents ?? 300))

  return async (
    params: ContextReactorParams<Context, Env>,
  ): Promise<ContextReactionResult> => {
    const context = asRecord(params.context.content)
    const config = await options.resolveConfig({
      runtime: params.runtime,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      eventId: params.eventId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
    })
    const actionSpecs = actionsToActionSpecs(params.actions) as Record<string, ResponsesActionSpec>
    const previousReactor = asRecord(params.context.reactor)
    const previousReactorState = asRecord(previousReactor.state)

    return await executeOpenAIResponsesReactionStep({
      config,
      systemPrompt: params.systemPrompt,
      events: params.events,
      triggerEvent: params.triggerEvent,
      eventId: params.eventId,
      executionId: params.executionId,
      contextId: params.contextId,
      stepId: params.stepId,
      iteration: params.iteration,
      maxModelSteps: params.maxModelSteps,
      actionSpecs,
      previousReactorState,
      contextStepStream: params.contextStepStream,
      writable: params.writable as WritableStream<unknown> | undefined,
      silent: params.silent,
      includeStreamTraceInOutput,
      includeRawProviderEventsInOutput,
      maxPersistedStreamEvents,
    })
  }
}
