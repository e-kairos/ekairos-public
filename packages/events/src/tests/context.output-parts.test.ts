/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"

import {
  convertItemToModelMessages,
  normalizeContextOutputPart,
  type ContextItem,
} from "../context.events.ts"
import { InstantStore } from "../stores/instant.store.ts"

describe("context output parts", () => {
  it("converts assistant tool outputs with multipart content into tool model messages", async () => {
    const messages = await convertItemToModelMessages({
      id: "assistant-1",
      type: "output",
      channel: "web",
      createdAt: new Date().toISOString(),
      content: {
        parts: [
          { type: "text", text: "Inspecting region." },
          {
            type: "tool-inspect_region",
            toolCallId: "tc_inspect_region_1",
            state: "output-available",
            input: {
              rect: { x: 120, y: 240, width: 360, height: 220 },
            },
            output: {
              type: "content",
              value: [
                {
                  type: "text",
                  text: "Zoomed crop for x:120 y:240 w:360 h:220",
                },
                {
                  type: "image-data",
                  data: "QUFBQQ==",
                  mediaType: "image/png",
                  filename: "inspect-region.png",
                },
              ],
            },
          },
        ],
      },
    } satisfies ContextItem)

    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages.some((message) => message.role === "assistant")).toBe(true)
    expect(messages.some((message) => message.role === "tool")).toBe(true)

    const toolMessage = messages.find((message) => message.role === "tool")
    expect(toolMessage).toBeTruthy()
    const toolContent = Array.isArray(toolMessage?.content) ? toolMessage?.content : []
    const toolResult = toolContent[0] as Record<string, unknown>
    expect(toolResult?.type).toBe("tool-result")

    const output = toolResult?.output as Record<string, unknown>
    expect(output?.type).toBe("content")
    expect(Array.isArray(output?.value)).toBe(true)
    expect((output.value as unknown[])).toHaveLength(2)
  })

  it("rebuilds model messages from event_parts instead of stale output item parts", async () => {
    const outputItem: ContextItem = {
      id: "reaction-1",
      type: "output",
      channel: "web",
      createdAt: new Date().toISOString(),
      content: {
        parts: [],
      },
    }

    const fakeDb = {
      async query(input: Record<string, unknown>) {
        if ("event_items" in input) {
          return {
            event_items: [
              {
                id: outputItem.id,
                execution: { id: "execution-1" },
              },
            ],
          }
        }

        if ("event_steps" in input) {
          return {
            event_steps: [
              {
                id: "step-1",
                iteration: 0,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
              },
            ],
          }
        }

        if ("event_parts" in input) {
          return {
            event_parts: [
              {
                idx: 0,
                part: {
                  type: "message",
                  content: {
                    text: "Inspecting region.",
                  },
                },
              },
              {
                idx: 1,
                part: {
                  type: "action",
                  content: {
                    status: "started",
                    actionCallId: "tc_inspect_region_1",
                    actionName: "inspect_region",
                    input: {
                        rect: { x: 120, y: 240, width: 360, height: 220 },
                    },
                  },
                },
              },
              {
                idx: 2,
                part: {
                  type: "action",
                  content: {
                    status: "completed",
                    actionCallId: "tc_inspect_region_1",
                    actionName: "inspect_region",
                    output: {
                      type: "content",
                      value: [
                        {
                          type: "text",
                          text: "Zoomed crop for x:120 y:240 w:360 h:220",
                        },
                        {
                          type: "image-data",
                          data: "QUFBQQ==",
                          mediaType: "image/png",
                          filename: "inspect-region.png",
                        },
                      ],
                    },
                  },
                },
              },
            ],
          }
        }

        return {}
      },
      tx: {},
      async transact() {
        return undefined
      },
    }

    const store = new InstantStore(fakeDb)
    const messages = (await store.itemsToModelMessages([outputItem])) as Array<ModelMessage & {
      role?: string
      content?: unknown
    }>

    expect(messages.length).toBeGreaterThanOrEqual(2)
    const toolMessage = messages.find((message) => message.role === "tool")
    expect(toolMessage).toBeTruthy()

    const toolContent = Array.isArray(toolMessage?.content) ? toolMessage?.content : []
    const toolResult = toolContent[0] as Record<string, unknown>
    const output = toolResult?.output as Record<string, unknown>
    expect(output?.type).toBe("content")
    expect(Array.isArray(output?.value)).toBe(true)
  })

  it("wraps raw outputs as json output parts", () => {
    expect(
      normalizeContextOutputPart({
        summary: "raw output",
      }),
    ).toEqual({
      type: "json",
      value: {
        summary: "raw output",
      },
    })
  })
})
