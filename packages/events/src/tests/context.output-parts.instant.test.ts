/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { tool, type ModelMessage } from "ai"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  createContext,
  createScriptedReactor,
  didToolExecute,
  eventsDomain,
  type ContextToolExecuteContext,
  type ContextItem,
} from "../index.ts"
import { InstantStore } from "../stores/instant.store.ts"
import { describeInstant, itInstant, destroyContextTestApp, provisionContextTestApp } from "./_env.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

type ContextTestEnv = {
  actorId: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  if (!root) return []
  const value = root[key]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

function readString(row: Record<string, unknown> | undefined, key: string): string | null {
  if (!row) return null
  const value = row[key]
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

function findPersistedActionPart(
  partRows: Record<string, unknown>[],
  actionName: string,
  status: "started" | "completed" | "failed",
): Record<string, unknown> | null {
  const legacyStateByStatus = {
    started: "input-available",
    completed: "output-available",
    failed: "output-error",
  } satisfies Record<"started" | "completed" | "failed", string>

  for (const row of partRows) {
    const part = asRecord(row.part)
    if (!part) continue

    const content = asRecord(part.content)
    if (
      part.type === "action" &&
      content?.status === status &&
      content?.actionName === actionName
    ) {
      return part
    }

    if (
      readString(part, "toolName") === actionName &&
      readString(part, "state") === legacyStateByStatus[status]
    ) {
      return part
    }
  }

  return null
}

function readPersistedActionOutput(
  part: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!part) return null
  if (part.type === "action") {
    return asRecord(asRecord(part.content)?.output)
  }

  const output = asRecord(part.output)
  if (output) return output

  if (Array.isArray(part.content)) {
    return {
      type: "content",
      value: part.content,
    }
  }

  return null
}

function createTriggerEvent(text: string): ContextItem {
  return {
    id: randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

async function inspectRuntimeExecute(
  { note }: { note: string },
  ctx: ContextToolExecuteContext<{ actorId: string }, ContextTestEnv>,
) {
  "use step"

  const db = await ctx.runtime.db()
  const contextContent = asRecord(ctx.context.content)
  return {
    type: "json" as const,
    value: {
      note,
      contextActorId: readString(contextContent ?? undefined, "actorId"),
      contextId: String(ctx.context.id),
      stepId: String(ctx.stepId),
      iteration: ctx.iteration,
      hasDb: Boolean(db),
    },
  }
}

let appId: string | null = null
let adminToken: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Context test runtime DB is not initialized.")
  }
  return db
}

describeInstant("context output parts + Instant runtime", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-output-parts-${Date.now()}`,
      schema,
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
    })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 5 * 60 * 1000)

  itInstant("persists multipart tool outputs on event_parts and replays from event_parts as the source of truth", async () => {
    const contextKey = `context-output-parts:${Date.now()}`
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      actorId: "user_context_tests",
    })

    const previewContext = createContext<ContextTestEnv>("context.tests.output-parts")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "Create one preview tool call and complete it.")
      .actions(() => ({
        inspect_region: tool({
          description: "Return a text explanation plus an image crop artifact.",
          inputSchema: z.object({
            rect: z.object({
              x: z.number(),
              y: z.number(),
              width: z.number(),
              height: z.number(),
            }),
          }),
          execute: async ({ rect }) => ({
            type: "content" as const,
            value: [
              {
                type: "text" as const,
                text: `Zoomed crop for x:${rect.x} y:${rect.y} w:${rect.width} h:${rect.height}`,
              },
              {
                type: "image-data" as const,
                data: "QUFBQQ==",
                mediaType: "image/png",
                filename: "inspect-region.png",
              },
            ],
          }),
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "Inspecting the requested region." },
                    {
                      type: "tool-inspect_region",
                      toolCallId: "tc_inspect_region_1",
                      state: "input-available",
                      input: {
                        rect: { x: 120, y: 240, width: 360, height: 220 },
                      },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "tc_inspect_region_1",
                  actionName: "inspect_region",
                  input: {
                    rect: { x: 120, y: 240, width: 360, height: 220 },
                  },
                },
              ],
              messagesForModel: [],
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "inspect_region"))
      .build()

    const shell = await previewContext.react(createTriggerEvent("zoom here"), {
      runtime,
      context: { key: contextKey },
      durable: false,
      options: {
        silent: true,
        maxIterations: 2,
        maxModelSteps: 1,
      },
    })
    const result = await shell.run!

    const snapshot = await currentDb().query({
      event_steps: {
        $: { where: { "execution.id": result.execution.id }, limit: 10 },
      },
    })

    const stepRows = readRows(snapshot, "event_steps")
    const stepId = readString(stepRows[0], "id")
    expect(stepId).toBeTruthy()
    const partsSnapshot = await currentDb().query({
      event_parts: {
        $: {
          where: { stepId: stepId as any },
          limit: 50,
          order: { idx: "asc" },
        },
      },
    })
    const partRows = readRows(partsSnapshot, "event_parts")

    const persistedToolCallPart = findPersistedActionPart(partRows, "inspect_region", "started")
    const persistedToolResultPart = findPersistedActionPart(partRows, "inspect_region", "completed")
    expect(
      readString(asRecord(persistedToolCallPart?.content) ?? undefined, "actionName"),
    ).toBe("inspect_region")
    expect(
      readString(asRecord(persistedToolResultPart?.content) ?? undefined, "status"),
    ).toBe("completed")
    const persistedOutput = readPersistedActionOutput(persistedToolResultPart)
    expect(readString(persistedOutput ?? undefined, "type")).toBe("content")
    const persistedContent = Array.isArray(persistedOutput?.value)
      ? persistedOutput?.value
      : []
    expect(persistedContent).toHaveLength(2)
    expect(readString(asRecord(persistedContent[0]) ?? undefined, "type")).toBe("text")
    expect(readString(asRecord(persistedContent[1]) ?? undefined, "type")).toBe("image-data")

    await currentDb().transact([
      currentDb().tx.event_items[result.reaction.id].update({
        content: {
          parts: [],
        },
      }),
    ])

    const store = new InstantStore(currentDb())
    const events = await store.getItems({ id: result.context.id })
    const modelMessages = (await store.itemsToModelMessages(events)) as Array<ModelMessage & {
      content?: unknown
      role?: string
    }>

    const toolMessage = modelMessages.find((message) => message.role === "tool")
    expect(toolMessage).toBeTruthy()
    const toolContents = Array.isArray(toolMessage?.content) ? toolMessage?.content : []
    const toolResult = toolContents.find((part) => asRecord(part)?.type === "tool-result")
    const toolResultOutput = asRecord(asRecord(toolResult)?.output)

    expect(readString(toolResultOutput ?? undefined, "type")).toBe("content")
    const replayedOutputParts = Array.isArray(toolResultOutput?.value) ? toolResultOutput?.value : []
    expect(replayedOutputParts).toHaveLength(2)
    expect(readString(asRecord(replayedOutputParts[1]) ?? undefined, "type")).toBe("image-data")
  }, 5 * 60 * 1000)

  itInstant("passes runtime and env into context tool execution", async () => {
    const contextKey = `context-tool-runtime:${Date.now()}`
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      actorId: "user_runtime_tests",
    })

    const runtimeAwareContext = createContext<ContextTestEnv>("context.tests.tool-runtime")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        actorId: env.actorId,
      }))
      .narrative(() => "Create one runtime-aware tool call and complete it.")
      .actions(() => ({
        inspect_runtime: tool({
          description: "Return runtime/env metadata as structured JSON.",
          inputSchema: z.object({
            note: z.string(),
          }),
          execute: inspectRuntimeExecute,
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "Inspecting runtime metadata." },
                    {
                      type: "tool-inspect_runtime",
                      toolCallId: "tc_inspect_runtime_1",
                      state: "input-available",
                      input: {
                        note: "hello-runtime",
                      },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "tc_inspect_runtime_1",
                  actionName: "inspect_runtime",
                  input: {
                    note: "hello-runtime",
                  },
                },
              ],
              messagesForModel: [],
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "inspect_runtime"))
      .build()

    const shell = await runtimeAwareContext.react(createTriggerEvent("inspect runtime"), {
      runtime,
      context: { key: contextKey },
      durable: false,
      options: {
        silent: true,
        maxIterations: 2,
        maxModelSteps: 1,
      },
    })
    const result = await shell.run!

    const snapshot = await currentDb().query({
      event_steps: {
        $: { where: { "execution.id": result.execution.id }, limit: 10 },
      },
    })

    const stepRows = readRows(snapshot, "event_steps")
    const stepId = readString(stepRows[0], "id")
    expect(stepId).toBeTruthy()
    const partsSnapshot = await currentDb().query({
      event_parts: {
        $: {
          where: { stepId: stepId as any },
          limit: 50,
          order: { idx: "asc" },
        },
      },
    })

    const partRows = readRows(partsSnapshot, "event_parts")
    const persistedToolResultPart = findPersistedActionPart(partRows, "inspect_runtime", "completed")
    expect(
      readString(asRecord(persistedToolResultPart?.content) ?? undefined, "status"),
    ).toBe("completed")
    const persistedOutput = readPersistedActionOutput(persistedToolResultPart)
    expect(readString(persistedOutput ?? undefined, "type")).toBe("json")
    const jsonPayload = asRecord(persistedOutput?.value)
    expect(readString(jsonPayload ?? undefined, "note")).toBe("hello-runtime")
    expect(readString(jsonPayload ?? undefined, "contextActorId")).toBe("user_runtime_tests")
    expect(readString(jsonPayload ?? undefined, "contextId")).toBe(String(result.context.id))
    expect(readString(jsonPayload ?? undefined, "stepId")).toBe(String(stepId))
    expect(readString(jsonPayload ?? undefined, "hasDb")).toBe(null)
    expect((jsonPayload as any)?.hasDb).toBe(true)
  }, 5 * 60 * 1000)
})
