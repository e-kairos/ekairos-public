import { tool } from "ai"
import { z } from "zod"

import {
  createContext,
  createScriptedReactor,
  didToolExecute,
  runContextReactionDirect,
  type ContextToolExecuteContext,
  type ContextDurableWorkflowPayload,
  type ContextItem,
} from "../index.js"

export type WorkflowSmokeEnv = {
  mode: "success" | "tool-error" | "scripted"
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

export function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  if (!root) return []
  const value = root[key]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

export function readString(
  row: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!row) return null
  const value = row[key]
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

export function buildTriggerEvent(text = "ping"): ContextItem {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

async function createSmokeSuccessModel() {
  "use step";
  return createSmokeModelForTool("story-smoke-success")
}

async function createSmokeToolErrorModel() {
  "use step";
  return createSmokeModelForTool("story-smoke-tool-error")
}

async function createSmokeModelForTool(modelId: string) {
  "use step";

  const { simulateReadableStream } = await import("ai")
  const { MockLanguageModelV2 } = await import("ai/test")

  return new MockLanguageModelV2({
    provider: "context-tests",
    modelId,
    doGenerate: async () => ({
      content: [
        { type: "text", text: "AI SDK reactor requesting echo." },
        {
          type: "tool-call",
          toolCallId: "smoke-tool-call",
          toolName: "echo",
          input: JSON.stringify({ message: "ping" }),
        },
      ],
      finishReason: "tool-calls",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text_1" },
          { type: "text-delta", id: "text_1", delta: "AI SDK reactor requesting echo." },
          { type: "text-end", id: "text_1" },
          { type: "tool-input-start", id: "smoke-tool-call", toolName: "echo" },
          { type: "tool-input-delta", id: "smoke-tool-call", delta: "{\"message\":\"ping\"}" },
          { type: "tool-input-end", id: "smoke-tool-call" },
          {
            type: "tool-call",
            toolCallId: "smoke-tool-call",
            toolName: "echo",
            input: JSON.stringify({ message: "ping" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          },
        ],
      }),
    }),
  })
}

async function executeEchoTool(
  { message }: { message: string },
  ctx: ContextToolExecuteContext<any, WorkflowSmokeEnv>,
  mode: WorkflowSmokeEnv["mode"],
) {
  "use step";

  if (mode === "tool-error") {
    throw new Error("echo_failed")
  }

  const db = await ctx.runtime.db()
  return {
    type: "json" as const,
    value: {
      ok: true,
      message,
      mode,
      contextId: String(ctx.context.id),
      stepId: String(ctx.stepId),
      hasDb: Boolean(db),
    },
  }
}

function createStorySmoke(mode: WorkflowSmokeEnv["mode"]) {
  if (mode === "scripted") {
    return createContext<WorkflowSmokeEnv>("story.smoke.scripted")
      .context((ctx) => ({ ...(ctx.content ?? {}) }))
      .narrative(() => "Story smoke deterministic workflow (scripted reactor).")
      .actions(() => ({
        echo: tool({
          description: "Return the input payload as a simple echo response.",
          inputSchema: z.object({ message: z.string() }),
          execute: (input, ctx) => executeEchoTool(input, ctx, mode),
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "Scripted reactor requesting echo." },
                    {
                      type: "tool-echo",
                      toolCallId: "scripted-smoke-tool-call",
                      input: { message: "ping" },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "scripted-smoke-tool-call",
                  actionName: "echo",
                  input: { message: "ping" },
                },
              ],
              messagesForModel: [],
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "echo"))
      .build()
  }

  const storyKey = mode === "tool-error" ? "story.smoke.tool-error" : "story.smoke"
  const model = mode === "tool-error" ? createSmokeToolErrorModel : createSmokeSuccessModel
  return createContext<WorkflowSmokeEnv>(storyKey)
    .context((ctx) => ({ ...(ctx.content ?? {}) }))
    .narrative(() => "Story smoke deterministic workflow.")
    .actions(() => ({
      echo: tool({
        description: "Return the input payload as a simple echo response.",
        inputSchema: z.object({ message: z.string() }),
        execute: (input, ctx) => executeEchoTool(input, ctx, mode),
      }),
    }))
    .model(model)
    .shouldContinue(() => false)
    .build()
}

export const storySmoke = createStorySmoke("success")
export const storySmokeToolError = createStorySmoke("tool-error")
export const storySmokeScripted = createStorySmoke("scripted")

export async function contextEngineDurableWorkflow(
  payload: ContextDurableWorkflowPayload<WorkflowSmokeEnv>,
) {
  "use workflow";

  const context =
    payload.contextKey === "story.smoke.scripted"
      ? storySmokeScripted
      : payload.contextKey === "story.smoke.tool-error"
        ? storySmokeToolError
        : payload.contextKey === "story.smoke"
          ? storySmoke
          : null

  if (!context) {
    throw new Error(`Unknown context key "${payload.contextKey}" for durable workflow`)
  }

  const { getWritable } = await import("workflow")
  return await runContextReactionDirect(context, payload.triggerEvent, {
    runtime: payload.runtime,
    context: payload.context ?? null,
    durable: false,
    options: {
      ...(payload.options ?? {}),
      writable: getWritable(),
    },
    __bootstrap: payload.bootstrap,
  })
}
