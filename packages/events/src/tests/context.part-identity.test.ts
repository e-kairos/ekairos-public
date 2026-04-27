import { describe, expect, it } from "vitest"

import {
  resolveContextPartChunkDescriptor,
  resolveContextPartChunkIdentity,
  resolveContextPartId,
  uuidV5,
} from "../context.part-identity.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("context part chunk identity", () => {
  it("creates deterministic UUIDs for the same canonical identity tuple", () => {
    // given
    // A provider part reference for a message chunk inside a concrete context step.
    const input = {
      stepId: "step_1",
      provider: "codex",
      providerPartId: "msg_1",
      partType: "message",
      partSlot: "message",
    }

    // when
    // The engine resolves the domain part id more than once from the same tuple.
    const first = resolveContextPartId(input)
    const second = resolveContextPartId(input)

    // then
    // The id is stable and UUID-shaped, so replay can address the same materialized part.
    expect(first).toBe(second)
    expect(first).toMatch(UUID_RE)
  })

  it("keeps action request and action result as different semantic parts", () => {
    // given
    // One provider action reference that produces both an input/request part and an output part.
    const base = {
      stepId: "step_1",
      provider: "codex",
      providerPartId: "call_1",
      partType: "action",
    }

    // when
    // The chunk descriptor changes from the started slot to the completed slot.
    const started = resolveContextPartId({ ...base, partSlot: "action:started" })
    const completed = resolveContextPartId({ ...base, partSlot: "action:completed" })

    // then
    // Both ids are deterministic but distinct, so command input and command output do not merge.
    expect(started).not.toBe(completed)
    expect(started).toMatch(UUID_RE)
    expect(completed).toMatch(UUID_RE)
  })

  it("derives the same message part identity across start, delta, and end chunks", () => {
    // given
    // Three stream chunks that mutate the same provider message item.
    const base = {
      stepId: "step_1",
      provider: "ai-sdk",
      providerPartId: "text_1",
    }

    // when
    // Each chunk type is converted into a context part chunk identity.
    const started = resolveContextPartChunkIdentity({ ...base, chunkType: "chunk.text_start" })
    const delta = resolveContextPartChunkIdentity({ ...base, chunkType: "chunk.text_delta" })
    const ended = resolveContextPartChunkIdentity({ ...base, chunkType: "chunk.text_end" })

    // then
    // They all target the same materialized message part.
    expect(started?.partType).toBe("message")
    expect(delta?.partType).toBe("message")
    expect(ended?.partType).toBe("message")
    expect(started?.partSlot).toBe("message")
    expect(delta?.partSlot).toBe("message")
    expect(ended?.partSlot).toBe("message")
    expect(started?.partId).toBe(delta?.partId)
    expect(delta?.partId).toBe(ended?.partId)
  })

  it("does not assign part identity to lifecycle chunks", () => {
    // given
    // A lifecycle chunk with a provider id-like value.
    const input = {
      stepId: "step_1",
      provider: "codex",
      providerPartId: "turn_1",
      chunkType: "chunk.finish",
    }

    // when
    // The engine attempts to resolve a semantic part descriptor.
    const descriptor = resolveContextPartChunkDescriptor(input)
    const identity = resolveContextPartChunkIdentity(input)

    // then
    // Lifecycle chunks stay out of the reconstructable part stream.
    expect(descriptor).toBeUndefined()
    expect(identity).toBeUndefined()
  })

  it("implements deterministic UUID v5 formatting", () => {
    // given
    // A stable namespace and name.
    const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
    const name = "www.example.com"

    // when
    // UUID v5 is resolved repeatedly.
    const first = uuidV5(name, namespace)
    const second = uuidV5(name, namespace)

    // then
    // The result remains deterministic and marks UUID version/variant bits correctly.
    expect(first).toBe(second)
    expect(first).toMatch(UUID_RE)
  })
})
