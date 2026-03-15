import type { ModelMessage, UIMessageChunk } from "ai"

import type { ContextEnvironment } from "../context.config.js"
import type { ContextModelInit } from "../context.engine.js"
import type { ContextIdentifier, StoredContext, ContextItem } from "../context.store.js"
import type { SerializableToolForModel } from "../tools-to-model-tools.js"

export type ContextActionRequest = {
  actionRef: string
  actionName: string
  input: unknown
}

export type ContextReactionLLM = {
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

export type ContextReactionResult = {
  assistantEvent: ContextItem
  actionRequests: ContextActionRequest[]
  messagesForModel: ModelMessage[]
  llm?: ContextReactionLLM
}

export type ContextReactorParams<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  env: Env
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  triggerEvent: ContextItem
  model: ContextModelInit
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
  writable?: WritableStream<UIMessageChunk>
  persistReactionParts?: (parts: any[]) => Promise<void>
}

export type ContextReactor<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
> = (
  params: ContextReactorParams<Context, Env>,
) => Promise<ContextReactionResult>
