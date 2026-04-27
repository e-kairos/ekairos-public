import { describe, expect, it } from "vitest"

import {
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
  parseContextStepStreamChunk,
} from "../context.step-stream.js"
import { resolveContextPartChunkIdentity } from "../context.part-identity.js"
import { parseContextStreamEvent } from "../context.stream.js"

describe("context step stream chunk validation", () => {
  it("accepts a semantic chunk with deterministic part identity", () => {
    // given
    // A text delta chunk whose provider id is mapped into one semantic message part.
    const stepId = "step_1"
    const identity = resolveContextPartChunkIdentity({
      stepId,
      provider: "codex",
      providerPartId: "msg_1",
      chunkType: "chunk.text_delta",
    })

    // when
    // The chunk is created, encoded, and parsed through the stream boundary.
    const chunk = createContextStepStreamChunk({
      stepId,
      sequence: 1,
      chunkType: "chunk.text_delta",
      provider: "codex",
      providerChunkType: "text_delta",
      partId: identity?.partId,
      providerPartId: identity?.providerPartId,
      partType: identity?.partType,
      partSlot: identity?.partSlot,
      data: { text: "hello" },
    })
    const parsed = parseContextStepStreamChunk(
      encodeContextStepStreamChunk(chunk, { stepId }),
      { stepId },
    )

    // then
    // The stream keeps the canonical part identity intact.
    expect(parsed.partId).toBe(identity?.partId)
    expect(parsed.providerPartId).toBe("msg_1")
    expect(parsed.partType).toBe("message")
    expect(parsed.partSlot).toBe("message")
  })

  it("rejects semantic chunks that do not carry part identity", () => {
    // given
    // A text chunk that would mutate a message part but has no controlled part fields.
    const input = {
      stepId: "step_1",
      sequence: 1,
      chunkType: "chunk.text_delta" as const,
      provider: "codex",
      providerChunkType: "text_delta",
      data: { text: "hello" },
    }

    // when / then
    // The writer refuses to persist a chunk that clients cannot reconstruct.
    expect(() => createContextStepStreamChunk(input)).toThrow(
      /context step stream chunk\.partId/,
    )
  })

  it("rejects semantic chunks with a part id from another step", () => {
    // given
    // A valid provider message id, but a partId computed from a different step.
    const identity = resolveContextPartChunkIdentity({
      stepId: "other_step",
      provider: "codex",
      providerPartId: "msg_1",
      chunkType: "chunk.text_delta",
    })

    // when / then
    // Deterministic validation catches that the chunk cannot belong to this step.
    expect(() =>
      createContextStepStreamChunk({
        stepId: "step_1",
        sequence: 1,
        chunkType: "chunk.text_delta",
        provider: "codex",
        providerChunkType: "text_delta",
        partId: identity?.partId,
        providerPartId: identity?.providerPartId,
        partType: identity?.partType,
        partSlot: identity?.partSlot,
      }),
    ).toThrow(/deterministic part identity/)
  })

  it("rejects lifecycle chunks that carry part identity", () => {
    // given
    // A finish chunk with semantic part fields attached by mistake.
    const input = {
      stepId: "step_1",
      sequence: 1,
      chunkType: "chunk.finish" as const,
      provider: "codex",
      providerChunkType: "finish",
      partId: "d9428888-122b-5aba-9d18-6ec828aa5245",
      providerPartId: "msg_1",
      partType: "message",
      partSlot: "message",
    }

    // when / then
    // Lifecycle chunks remain lifecycle-only and cannot masquerade as part chunks.
    expect(() => createContextStepStreamChunk(input)).toThrow(
      /lifecycle\/metadata chunks cannot carry part identity/,
    )
  })

  it("validates chunk.emitted events with the same part identity contract", () => {
    // given
    // A public stream event for an action output part.
    const stepId = "step_1"
    const identity = resolveContextPartChunkIdentity({
      stepId,
      provider: "codex",
      providerPartId: "call_1",
      chunkType: "chunk.action_output_available",
    })

    // when
    // The public event is parsed at the client-facing event boundary.
    const event = parseContextStreamEvent({
      type: "chunk.emitted",
      at: new Date().toISOString(),
      contextId: "context_1",
      executionId: "execution_1",
      stepId,
      itemId: "item_1",
      sequence: 1,
      chunkType: "chunk.action_output_available",
      provider: "codex",
      providerChunkType: "action_output_available",
      actionRef: "call_1",
      partId: identity?.partId,
      providerPartId: identity?.providerPartId,
      partType: identity?.partType,
      partSlot: identity?.partSlot,
    })

    // then
    // Public chunk events obey the same action part structure as persisted chunks.
    expect(event.type).toBe("chunk.emitted")
    expect(event.partType).toBe("action")
    expect(event.partSlot).toBe("action:completed")
  })
})
