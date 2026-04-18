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
} from "../../index.ts"

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
) {
  "use step";

  if (ctx.env.mode === "tool-error") {
    throw new Error("echo_failed")
  }

  const db = await ctx.runtime.db()
  return {
    type: "json" as const,
    value: {
      ok: true,
      message,
      mode: ctx.env.mode,
      runtimeMode: String((ctx.runtime as any).env?.mode ?? ""),
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
          execute: executeEchoTool,
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
        execute: executeEchoTool,
      }),
    }))
    .model(model)
    .shouldContinue(() => false)
    .build()
}

export const storySmoke = createStorySmoke("success")
export const storySmokeToolError = createStorySmoke("tool-error")
export const storySmokeScripted = createStorySmoke("scripted")
export const storySmokeExpandedEvents = createContext<WorkflowSmokeEnv>("story.smoke.expanded-events")
  .context((ctx) => ({ ...(ctx.content ?? {}) }))
  .expandEvents((events) => [
    ...events,
    {
      id: `derived:${events[0]?.id ?? "missing"}:canvas`,
      type: "output",
      channel: "web",
      createdAt: new Date().toISOString(),
      content: {
        parts: [
          {
            type: "content",
            state: "done",
            content: [
              {
                type: "text",
                text: "Derived canvas snapshot reference.",
              },
              {
                type: "file",
                mediaType: "image/png",
                filename: "canvas.png",
                data: "QUFBQQ==",
              },
            ],
            metadata: {
              canvas: {
                sceneId: "scene_workflow_expanded",
                sceneVersion: 7,
                sceneRect: { x: 10, y: 20, width: 300, height: 200 },
                scaleX: 1,
                scaleY: 1,
              },
            },
          },
        ],
      },
    } satisfies ContextItem,
  ])
  .narrative(() => "Expanded event workflow smoke.")
  .actions(() => ({}))
  .reactor(
    createScriptedReactor({
      steps: [
        (params) => {
          const sawExpandedEvent = params.events.some((event) =>
            String(event.id).startsWith("derived:") &&
            JSON.stringify(event.content.parts ?? []).includes("Derived canvas snapshot reference"),
          )
          if (!sawExpandedEvent) {
            throw new Error("expanded_events_missing")
          }
          return {
            assistantEvent: {
              content: {
                parts: [{ type: "text", text: "Expanded event received." }],
              },
            },
            actionRequests: [],
            messagesForModel: [],
          }
        },
      ],
    }),
  )
  .shouldContinue(() => false)
  .build()

export async function contextEngineDurableWorkflow(
  payload: ContextDurableWorkflowPayload<WorkflowSmokeEnv>,
) {
  "use workflow";

  const context =
    payload.contextKey === "story.smoke.expanded-events"
      ? storySmokeExpandedEvents
      : payload.contextKey === "story.smoke.scripted"
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
