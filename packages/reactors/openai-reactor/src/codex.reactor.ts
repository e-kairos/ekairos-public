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
  mapChunk?: (providerChunk: unknown) => CodexChunkMappingResult
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function mapCodexChunkType(providerChunkType: string): ThreadStreamChunkType {
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

function defaultMapCodexChunk(providerChunk: unknown): CodexChunkMappingResult {
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
  let chunkSequence = 0

  return async (
    params: ThreadReactorParams<Context, Env>,
  ): Promise<ThreadReactionResult> => {
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

    const emitChunk = async (providerChunk: unknown) => {
      if (params.silent) return
      const mapped = options.mapChunk
        ? options.mapChunk(providerChunk)
        : defaultMapCodexChunk(providerChunk)

      const payload = {
        type: "chunk.emitted",
        at: new Date().toISOString(),
        chunkType: mapped.chunkType,
        contextId: params.contextId,
        executionId: params.executionId,
        stepId: params.stepId,
        itemId: params.eventId,
        actionRef: mapped.actionRef,
        provider: "codex",
        providerChunkType: mapped.providerChunkType,
        sequence: ++chunkSequence,
        data: mapped.data,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
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
      },
    }
  }
}
