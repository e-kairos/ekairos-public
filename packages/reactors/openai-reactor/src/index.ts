import {
  OUTPUT_TEXT_ITEM_TYPE,
  createAiSdkReactor,
  type CreateAiSdkReactorOptions,
  type ThreadItem,
  type ThreadReactionResult,
  type ThreadReactor,
  type ThreadReactorParams,
} from "@ekairos/thread"
import type { ThreadEnvironment } from "@ekairos/thread/runtime"

type AnyRecord = Record<string, unknown>

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  const out: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    const partType = asString(record.type)
    if (partType === "text") {
      const value = asString(record.text).trim()
      if (value) out.push(value)
      continue
    }
    if (partType === "input_text") {
      const value = asString(record.input_text).trim()
      if (value) out.push(value)
      continue
    }
    const inline = asString(record.text).trim()
    if (inline) out.push(inline)
  }
  return out.join("\n").trim()
}

function defaultInstructionFromTrigger(event: ThreadItem): string {
  const content = asRecord(event.content)
  const message = textFromParts(content.parts)
  return message || "Continue with the current task."
}

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
  writable?: unknown
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

function buildCodexParts(params: {
  toolName: string
  includeReasoningPart: boolean
  result: CodexTurnResult
  instruction: string
}) {
  const parts: AnyRecord[] = []
  const assistantText = asString(params.result.assistantText).trim()
  const reasoningText = asString(params.result.reasoningText).trim()

  if (assistantText) {
    parts.push({ type: "text", text: assistantText })
  }

  if (params.includeReasoningPart && reasoningText) {
    parts.push({ type: "reasoning", text: reasoningText })
  }

  const metadata = {
    threadId: params.result.threadId,
    turnId: params.result.turnId,
    diff: params.result.diff ?? "",
    toolParts: params.result.toolParts ?? [],
    ...(params.result.metadata ?? {}),
  }

  parts.push({
    type: `tool-${params.toolName}`,
    toolCallId: params.result.turnId || params.result.threadId,
    state: "output-available",
    input: { instruction: params.instruction },
    output: metadata,
    metadata,
  })

  return parts
}

/**
 * Default AI SDK reactor exported by package for convenience.
 */
export function createOpenAIReactor<
  Context,
  Env extends ThreadEnvironment = ThreadEnvironment,
  Config = unknown,
>(
  options?: CreateAiSdkReactorOptions<Context, Env, Config>,
): ThreadReactor<Context, Env> {
  return createAiSdkReactor<Context, Env, Config>(options)
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
