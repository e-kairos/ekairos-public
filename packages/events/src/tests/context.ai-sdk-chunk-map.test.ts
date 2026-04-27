import { describe, expect, it } from "vitest"

import { mapAiSdkChunkToContextEvent } from "../reactors/ai-sdk.chunk-map.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("AI SDK chunk map part identity", () => {
  it("maps text chunks with the same AI SDK id to the same message part id", () => {
    // given
    // AI SDK text stream chunks that share the provider part id.
    const base = {
      contextId: "context_1",
      executionId: "execution_1",
      stepId: "step_1",
      itemId: "reaction_1",
      provider: "openai",
    }

    // when
    // The chunks are converted to context stream events.
    const started = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 1,
      chunk: { type: "text-start", id: "text_1" },
    })
    const delta = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 2,
      chunk: { type: "text-delta", id: "text_1", delta: "Hello" },
    })
    const ended = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 3,
      chunk: { type: "text-end", id: "text_1" },
    })

    // then
    // The client can reduce all chunks into one controlled message part.
    expect(started.partType).toBe("message")
    expect(delta.partType).toBe("message")
    expect(ended.partType).toBe("message")
    expect(started.providerPartId).toBe("text_1")
    expect(delta.providerPartId).toBe("text_1")
    expect(ended.providerPartId).toBe("text_1")
    expect(started.partId).toBe(delta.partId)
    expect(delta.partId).toBe(ended.partId)
    expect(delta.partId).toMatch(UUID_RE)
  })

  it("maps one tool call into separate started and completed action part ids", () => {
    // given
    // AI SDK tool chunks with one provider tool call id.
    const base = {
      contextId: "context_1",
      executionId: "execution_1",
      stepId: "step_1",
      itemId: "reaction_1",
      provider: "openai",
    }

    // when
    // The tool input and output chunks are mapped.
    const input = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 1,
      chunk: {
        type: "tool-input-available",
        toolCallId: "call_1",
        toolName: "lookup",
        input: { q: "status" },
      },
    })
    const output = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 2,
      chunk: {
        type: "tool-output-available",
        toolCallId: "call_1",
        output: { ok: true },
      },
    })

    // then
    // The provider id correlates both chunks, but the semantic part slots stay distinct.
    expect(input.providerPartId).toBe("call_1")
    expect(output.providerPartId).toBe("call_1")
    expect(input.partType).toBe("action")
    expect(output.partType).toBe("action")
    expect(input.partSlot).toBe("action:started")
    expect(output.partSlot).toBe("action:completed")
    expect(input.partId).not.toBe(output.partId)
    expect(input.partId).toMatch(UUID_RE)
    expect(output.partId).toMatch(UUID_RE)
  })

  it("does not assign part identity to AI SDK lifecycle chunks", () => {
    // given
    // A lifecycle chunk that is not a semantic part mutation.
    const base = {
      contextId: "context_1",
      executionId: "execution_1",
      stepId: "step_1",
      itemId: "reaction_1",
      provider: "openai",
    }

    // when
    // The chunk is mapped.
    const event = mapAiSdkChunkToContextEvent({
      ...base,
      sequence: 1,
      chunk: { type: "finish", finishReason: "stop" },
    })

    // then
    // It remains a lifecycle stream event, not a reconstructable part chunk.
    expect(event.chunkType).toBe("chunk.finish")
    expect(event.partId).toBeUndefined()
    expect(event.providerPartId).toBeUndefined()
    expect(event.partType).toBeUndefined()
  })
})
