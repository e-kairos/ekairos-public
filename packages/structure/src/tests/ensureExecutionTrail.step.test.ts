import { describe, expect, it, vi } from "vitest"

const saveItem = vi.fn()
const createExecution = vi.fn()
const linkItemToExecution = vi.fn()
const getItems = vi.fn()

vi.mock("@ekairos/events/runtime", () => ({
  getThreadRuntime: vi.fn(async () => ({
    store: {
      saveItem,
      createExecution,
      linkItemToExecution,
      getItems,
    },
  })),
}))

describe("ensureExecutionTrailStep", () => {
  it("creates deterministic ids for recreated request/output items and serializes errors", async () => {
    const { ensureExecutionTrailStep } = await import("../steps/ensureExecutionTrail.step.js")

    getItems.mockResolvedValueOnce([])
    saveItem
      .mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111" })
      .mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222" })
    createExecution.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
    })

    await ensureExecutionTrailStep({
      env: { orgId: "org-test" },
      contextKey: "structure:test-dataset",
      datasetId: "test-dataset",
      output: "object",
      requestItemId: "missing-request-id",
      status: "failed",
      error: new Error("boom"),
    })

    expect(saveItem).toHaveBeenCalledTimes(2)
    const recreatedRequest = saveItem.mock.calls[0]?.[1]
    const outputItem = saveItem.mock.calls[1]?.[1]
    expect(recreatedRequest?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(outputItem?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(outputItem?.content?.structure_build?.error).toEqual({
      name: "Error",
      message: "boom",
    })
    expect(createExecution).toHaveBeenCalledWith(
      { key: "structure:test-dataset" },
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    )
  })
})
