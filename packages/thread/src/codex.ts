import { tool } from "ai"
import { z } from "zod"

import { createThread } from "./thread.js"
import { didToolExecute } from "./thread.toolcalls.js"
import type { ThreadEnvironment } from "./thread.config.js"
import type {
  ThreadModelInit,
  ThreadOptions,
  ThreadReactParams,
  ThreadShouldContinueArgs,
  ThreadTool,
} from "./thread.engine.js"
import type { ThreadKey } from "./thread.registry.js"
import type { StoredContext, ThreadItem } from "./thread.store.js"
import type { ThreadInstance } from "./thread.js"

export const DEFAULT_CODEX_TOOL_NAME = "codex"
export const DEFAULT_CODEX_MODEL = "openai/gpt-5.2"

export type CodexThreadRuntimeMode = "local" | "remote" | "sandbox"
export type CodexThreadReasoningLevel = "off" | "low" | "medium" | "high"

export type CodexThreadRuntime = {
  appServerUrl?: string
  repoPath?: string
  threadId?: string
  mode?: CodexThreadRuntimeMode
  model?: string
  approvalPolicy?: string
  sandboxPolicy?: Record<string, unknown>
}

export type CodexThreadEnv = ThreadEnvironment & {
  sessionId: string
  runtime?: CodexThreadRuntime
  reasoningLevel?: CodexThreadReasoningLevel
  model?: string
}

export type CodexToolInput = {
  instruction: string
  files?: Array<{
    url?: string
    path?: string
    mediaType?: string
    fileId?: string
  }>
}

export type CodexToolOutput = {
  threadId: string
  turnId: string
  assistantText: string
  reasoningText: string
  diff: string
  toolParts: any[]
}

export const codexToolInputSchema = z.object({
  instruction: z
    .string()
    .describe("The coding instruction to execute for this request."),
  files: z
    .array(
      z.object({
        url: z.string().optional(),
        path: z.string().optional(),
        mediaType: z.string().optional(),
        fileId: z.string().optional(),
      }),
    )
    .optional(),
})

export type CodexExecuteArgs<
  Context,
  Env extends CodexThreadEnv = CodexThreadEnv,
> = {
  context: StoredContext<Context>
  env: Env
  input: CodexToolInput
  toolName: string
}

export type CodexThreadBuilderConfig<
  Context,
  Env extends CodexThreadEnv = CodexThreadEnv,
> = {
  key: ThreadKey
  context: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Context> | Context
  executeCodex: (
    args: CodexExecuteArgs<Context, Env>,
  ) => Promise<CodexToolOutput>
  narrative?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<string> | string
  system?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<string> | string
  actions?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Record<string, ThreadTool>> | Record<string, ThreadTool>
  model?:
    | ThreadModelInit
    | ((context: StoredContext<Context>, env: Env) => ThreadModelInit)
  shouldContinue?: (
    args: ThreadShouldContinueArgs<Context, Env>,
  ) => Promise<boolean> | boolean
  toolName?: string
  toolDescription?: string
  opts?: ThreadOptions<Context, Env>
}

export type CodexThreadBuilder<
  Context,
  Env extends CodexThreadEnv = CodexThreadEnv,
> = {
  key: ThreadKey
  react(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ): Promise<{
    contextId: string
    context: StoredContext<Context>
    triggerEventId: string
    reactionEventId: string
    executionId: string
  }>
  stream(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ): Promise<{
    contextId: string
    context: StoredContext<Context>
    triggerEventId: string
    reactionEventId: string
    executionId: string
  }>
  register(): void
  config(): unknown
  build(): ThreadInstance<Context, Env>
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function toString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function buildDefaultCodexNarrative(content: unknown): string {
  const record = toRecord(content)
  const sessionId = toString(record.sessionId)
  const repoUrl = toString(record.repoUrl)
  const branchName = toString(record.branchName)

  return [
    "You are Codex running as an Ekairos Thread.",
    "",
    "Execution style:",
    "- Execute real coding work via the `codex` action.",
    "- Keep answers concrete and implementation-oriented.",
    "- Preserve repository and branch continuity across turns.",
    "",
    "Context:",
    `- Session: ${sessionId || "unknown"}`,
    `- Repository: ${repoUrl || "unknown"}`,
    `- Branch: ${branchName || "unknown"}`,
  ].join("\n")
}

export function didCodexToolExecute(
  event: Pick<{ content: any }, "content">,
  toolName = DEFAULT_CODEX_TOOL_NAME,
): boolean {
  return didToolExecute(event as any, toolName)
}

export function createCodexThreadBuilder<
  Context,
  Env extends CodexThreadEnv = CodexThreadEnv,
>(config: CodexThreadBuilderConfig<Context, Env>) {
  const toolName = config.toolName ?? DEFAULT_CODEX_TOOL_NAME
  const toolDescription =
    config.toolDescription ??
    "Run the coding request using a Codex app server and stream output."

  const narrative =
    config.narrative ??
    config.system ??
    ((ctx: StoredContext<Context>) =>
      buildDefaultCodexNarrative((ctx as any)?.content))

  const model =
    config.model ??
    ((_ctx: StoredContext<Context>, env: Env) =>
      (typeof env.model === "string" && env.model.trim()) || DEFAULT_CODEX_MODEL)

  const shouldContinue =
    config.shouldContinue ??
    ((args: ThreadShouldContinueArgs<Context, Env>) =>
      !didToolExecute(args.reactionEvent, toolName))

  let builder = createThread<Env>(config.key)
    .context(config.context)
    .narrative(narrative)
    .actions(async (ctx, env) => {
      const additional = config.actions ? await config.actions(ctx, env) : {}
      if (Object.prototype.hasOwnProperty.call(additional, toolName)) {
        throw new Error(
          `createCodexThreadBuilder: action "${toolName}" is reserved for Codex.`,
        )
      }
      return {
        ...additional,
        [toolName]: tool({
          description: toolDescription,
          inputSchema: codexToolInputSchema,
          execute: async (input: CodexToolInput) =>
            await config.executeCodex({
              context: ctx,
              env,
              input,
              toolName,
            }),
        }),
      }
    })
    .model(model as any)
    .shouldContinue(shouldContinue as any)

  if (config.opts) {
    builder = builder.opts(config.opts)
  }

  return builder as unknown as CodexThreadBuilder<Context, Env>
}
