import {
  OUTPUT_TEXT_ITEM_TYPE,
  type ThreadItem,
  type ThreadReactionResult,
  type ThreadReactor,
  type ThreadReactorParams,
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
    })

    const assistantEvent: ThreadItem = {
      id: params.eventId,
      type: OUTPUT_TEXT_ITEM_TYPE,
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
      toolCalls: [],
      messagesForModel: [],
      llm: {
        provider: "openai",
        model: asString(config.model || "codex"),
      },
    }
  }
}
