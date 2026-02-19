import type { ModelMessage, UIMessageChunk } from "ai"

import type { ThreadEnvironment } from "../thread.config.js"
import type { ThreadModelInit } from "../thread.engine.js"
import type { ContextIdentifier, StoredContext, ThreadItem } from "../thread.store.js"
import type { SerializableToolForModel } from "../tools-to-model-tools.js"

export type ThreadReactionToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
}

export type ThreadReactionLLM = {
  provider?: string
  model?: string
  promptTokens?: number
  promptTokensCached?: number
  promptTokensUncached?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number
  rawUsage?: unknown
  rawProviderMetadata?: unknown
}

export type ThreadReactionResult = {
  assistantEvent: ThreadItem
  toolCalls: ThreadReactionToolCall[]
  messagesForModel: ModelMessage[]
  llm?: ThreadReactionLLM
}

export type ThreadReactorParams<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = {
  env: Env
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  triggerEvent: ThreadItem
  model: ThreadModelInit
  systemPrompt: string
  actions: Record<string, unknown>
  toolsForModel: Record<string, SerializableToolForModel>
  eventId: string
  executionId: string
  contextId: string
  stepId: string
  iteration: number
  maxModelSteps: number
  sendStart: boolean
  silent: boolean
  writable: WritableStream<UIMessageChunk>
}

export type ThreadReactor<
  Context = unknown,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = (
  params: ThreadReactorParams<Context, Env>,
) => Promise<ThreadReactionResult>
