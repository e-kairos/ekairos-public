import { describe, expect, it, vi } from "vitest"

import { parseContextStepStreamChunk, type ContextItem } from "@ekairos/events"

const mockTransport = vi.hoisted(() => ({
  requests: [] as any[],
  events: [] as any[],
}))

vi.mock("../responses.websocket.js", () => ({
  streamOpenAIResponsesWebSocket: async (params: any) => {
    mockTransport.requests.push(params.request)
    const baseMetrics = {
      cacheKey: "mock-cache",
      connectionId: "mock-connection",
      connectionMode: mockTransport.requests.length > 1 ? "hot" : "cold",
      reusedConnection: mockTransport.requests.length > 1,
      acquireMs: mockTransport.requests.length > 1 ? 0 : 12,
      handshakeMs: mockTransport.requests.length > 1 ? 0 : 12,
      providerEventCount: 0,
      firstProviderEventMs: 10,
      firstTextDeltaMs: 20,
      completedMs: 30,
    }
    let count = 0
    for (const event of mockTransport.events) {
      count += 1
      await params.onEvent(event, {
        ...baseMetrics,
        providerEventCount: count,
      })
    }
    return {
      ...baseMetrics,
      providerEventCount: count,
    }
  },
}))

import { executeOpenAIResponsesReactionStep } from "../index.js"

function inputItem(id: string, text: string): ContextItem {
  return {
    id,
    type: "input",
    channel: "web",
    createdAt: new Date("2026-04-30T00:00:00.000Z").toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

function collectWriters() {
  const stepLines: string[] = []
  const uiChunks: any[] = []
  return {
    stepLines,
    uiChunks,
    contextStepStream: new WritableStream<string>({
      write(chunk) {
        stepLines.push(String(chunk))
      },
    }),
    writable: new WritableStream<any>({
      write(chunk) {
        uiChunks.push(chunk)
      },
    }),
  }
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  const event = inputItem("input-1", "Say OK.")
  return {
    config: {
      model: "gpt-5.2",
      webSocketUrl: "wss://example.test/v1/responses",
      headers: { Authorization: "Bearer test" },
      providerName: "openai-responses-test",
      reuseHotConnection: true,
    },
    systemPrompt: "Be concise.",
    events: [event],
    triggerEvent: event,
    eventId: "output-1",
    executionId: "exec-1",
    contextId: "ctx-1",
    stepId: "step-1",
    iteration: 0,
    maxModelSteps: 1,
    actionSpecs: {},
    silent: false,
    includeStreamTraceInOutput: true,
    includeRawProviderEventsInOutput: false,
    maxPersistedStreamEvents: 100,
    ...overrides,
  }
}

describe("executeOpenAIResponsesReactionStep", () => {
  it("maps Responses text events to context step stream chunks and canonical message parts", async () => {
    mockTransport.requests = []
    mockTransport.events = [
      {
        type: "response.created",
        response: { id: "resp_text", created_at: 1, model: "gpt-5.2" },
      },
      {
        type: "response.in_progress",
        response: { id: "resp_text", model: "gpt-5.2" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_text" },
      },
      {
        type: "response.content_part.added",
        item_id: "msg_text",
        output_index: 0,
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_text",
        output_index: 0,
        delta: "OK",
      },
      {
        type: "response.output_text.done",
        item_id: "msg_text",
        output_index: 0,
        text: "OK",
      },
      {
        type: "response.content_part.done",
        item_id: "msg_text",
        output_index: 0,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "message", id: "msg_text" },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_text",
          model: "gpt-5.2",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    ]

    const writers = collectWriters()
    const result = await executeOpenAIResponsesReactionStep({
      ...baseArgs(),
      contextStepStream: writers.contextStepStream,
      writable: writers.writable,
    })

    expect(result.actionRequests).toEqual([])
    expect(result.assistantEvent.content.parts).toEqual([
      expect.objectContaining({
        type: "message",
        content: { text: "OK" },
      }),
    ])
    expect(result.llm?.promptTokens).toBe(10)
    expect(result.reactor?.state?.responseId).toBe("resp_text")
    expect(result.reactor?.state?.connectionMode).toBe("cold")
    expect((result.reactor?.state?.lastMetrics as any)?.connectionMode).toBe("cold")
    expect((result.llm?.rawProviderMetadata as any)?.transport?.connectionMode).toBe("cold")

    const stepChunks = writers.stepLines.map((line) => parseContextStepStreamChunk(line))
    expect(stepChunks.map((chunk) => chunk.chunkType)).toEqual([
      "chunk.response_metadata",
      "chunk.response_metadata",
      "chunk.text_start",
      "chunk.response_metadata",
      "chunk.text_delta",
      "chunk.text_end",
      "chunk.response_metadata",
      "chunk.response_metadata",
      "chunk.finish",
    ])
    expect(
      writers.uiChunks.filter((chunk) => chunk?.type === "data-chunk.emitted"),
    ).toHaveLength(stepChunks.length)
  })

  it("maps function-call events to action parts, requests, and action chunk identities", async () => {
    mockTransport.requests = []
    mockTransport.events = [
      {
        type: "response.created",
        response: { id: "resp_tool", created_at: 1, model: "gpt-5.2" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "echo_status",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: "{\"value\":\"ok\"}",
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "echo_status",
          arguments: "{\"value\":\"ok\"}",
          status: "completed",
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_tool",
          model: "gpt-5.2",
          usage: { input_tokens: 14, output_tokens: 4 },
        },
      },
    ]

    const writers = collectWriters()
    const result = await executeOpenAIResponsesReactionStep({
      ...baseArgs({
        actionSpecs: {
          echo_status: {
            type: "function",
            description: "Echo status.",
            inputSchema: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
        },
      }),
      contextStepStream: writers.contextStepStream,
      writable: writers.writable,
    })

    expect(mockTransport.requests[0]?.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "echo_status",
      }),
    ])
    expect(result.actionRequests).toEqual([
      {
        actionRef: "call_1",
        actionName: "echo_status",
        input: { value: "ok" },
      },
    ])
    expect(result.assistantEvent.content.parts).toEqual([
      expect.objectContaining({
        type: "action",
        content: {
          status: "started",
          actionName: "echo_status",
          actionCallId: "call_1",
          input: { value: "ok" },
        },
      }),
    ])

    const actionChunks = writers.stepLines
      .map((line) => parseContextStepStreamChunk(line, { stepId: "step-1" }))
      .filter((chunk) => chunk.chunkType.startsWith("chunk.action_"))

    expect(actionChunks.length).toBeGreaterThan(0)
    expect(
      actionChunks.every((chunk) => chunk.providerPartId === "call_1" && chunk.actionRef === "call_1"),
    ).toBe(true)
  })

  it("compacts action JSON schemas before sending them to Responses", async () => {
    mockTransport.requests = []
    mockTransport.events = [
      {
        type: "response.completed",
        response: {
          id: "resp_schema",
          model: "gpt-5.2",
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
    ]

    const longDescription = "This field is useful. ".repeat(80)
    await executeOpenAIResponsesReactionStep({
      ...baseArgs({
        actionSpecs: {
          normalize_record: {
            type: "function",
            description: "Normalize a supplier import row. ".repeat(80),
            inputSchema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              description: longDescription,
              default: { name: "ignored" },
              examples: [{ name: "ignored" }],
              properties: {
                default: {
                  type: "string",
                  description: "A real business field named default.",
                },
                description: {
                  type: "string",
                  description: "A real business field named description.",
                },
                name: {
                  type: "string",
                  title: "Supplier legal name",
                  description: longDescription,
                },
                title: {
                  type: "string",
                  description: "A real business field named title.",
                },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
      }),
    })

    const tool = mockTransport.requests[0]?.tools?.[0]
    const parameters = tool?.parameters
    expect(tool?.description.length).toBeLessThanOrEqual(1_200)
    expect(JSON.stringify(parameters)).not.toContain("$schema")
    expect(JSON.stringify(parameters)).not.toContain("\"examples\"")
    expect(parameters.default).toBeUndefined()
    expect(parameters.description.length).toBeLessThanOrEqual(240)
    expect(parameters.properties.default.type).toBe("string")
    expect(parameters.properties.description.type).toBe("string")
    expect(parameters.properties.name.description.length).toBeLessThanOrEqual(240)
    expect(parameters.properties.title.type).toBe("string")
  })
})
