import { describe, expect, it } from "vitest"

import { findLatestCompleteToolOutput } from "../steps/completeOutput.js"

describe("findLatestCompleteToolOutput", () => {
  it("reads completed complete action output from current context parts", () => {
    const first = { success: true, result: { value: 1 } }
    const latest = { success: true, result: { value: 2 } }

    const output = findLatestCompleteToolOutput([
      {
        content: {
          parts: [
            {
              type: "action",
              content: {
                status: "completed",
                actionName: "complete",
                actionCallId: "call_1",
                output: first,
              },
            },
          ],
        },
      },
      {
        content: {
          parts: [
            {
              type: "action",
              content: {
                status: "completed",
                actionName: "complete",
                actionCallId: "call_2",
                output: latest,
              },
            },
          ],
        },
      },
    ])

    expect(output).toBe(latest)
  })

  it("keeps reading legacy tool-complete parts", () => {
    const legacy = { success: true, result: { ok: true } }

    const output = findLatestCompleteToolOutput([
      {
        content: {
          parts: [
            {
              type: "tool-complete",
              state: "output-available",
              output: legacy,
            },
          ],
        },
      },
    ])

    expect(output).toBe(legacy)
  })
})

