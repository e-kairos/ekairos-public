import type { ModelMessage, UIMessageChunk } from "ai"
import type { DomainSchemaResult } from "@ekairos/domain"

import type { ContextEnvironment } from "../context.config.js"
import type { ContextTool } from "../context.action.js"
import type { ContextRuntime, ContextRuntimeHandleForDomain } from "../context.runtime.js"
import type { ContextModelInit } from "../context.engine.js"
import type { ContextIdentifier, StoredContext, ContextItem } from "../context.store.js"
import type { ContextSkillPackage } from "../context.skill.js"
import { eventsDomain } from "../schema.js"

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
  reactor?: {
    kind: string
    state?: Record<string, unknown> | null
  }
}

export type ContextReactorParams<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = any,
> = {
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  /**
   * Context items after the engine-level expansion stage.
   *
   * Reactors should prefer these over fetching raw items when constructing
   * model/runtime input. Expanders must return regular ContextItems whose
   * parts follow the shared context part contract, so this is not tied to any
   * specific model provider.
   */
  events: ContextItem[]
  triggerEvent: ContextItem
  model: ContextModelInit
  systemPrompt: string
  actions: Record<string, ContextTool<Context, Env, RequiredDomain, Runtime>>
  skills: ContextSkillPackage[]
  eventId: string
  executionId: string
  contextId: string
  stepId: string
  iteration: number
  maxModelSteps: number
  sendStart: boolean
  silent: boolean
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<UIMessageChunk>
  persistReactionParts?: (parts: any[]) => Promise<void>
}

export type ContextReactor<
  Context = unknown,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = any,
> = (
  params: ContextReactorParams<Context, Env, RequiredDomain, Runtime>,
) => Promise<ContextReactionResult>
