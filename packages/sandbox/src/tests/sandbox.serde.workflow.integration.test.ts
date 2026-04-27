/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  sandboxSerdeRoundTripWorkflow,
  SandboxSerdeRuntime,
} from "./sandbox.workflow-fixtures"

describe("sandbox workflow serde", () => {
  it("round-trips a Sandbox handle with its runtime across workflow steps", async () => {
    const runtime = new SandboxSerdeRuntime({
      marker: `sandbox-serde-${Date.now()}`,
    })
    const sandboxId = `sandbox_${Date.now()}`

    const run = await start(sandboxSerdeRoundTripWorkflow, [
      runtime,
      {
        sandboxId,
        command: "pnpm",
        args: ["test"],
      },
    ])
    const result = await run.returnValue

    expect(result.sandboxInstance).toBe(true)
    expect(result.sandboxId).toBe(sandboxId)
    expect(result.state).toMatchObject({
      version: 1,
      sandboxId,
      provider: "sprites",
      runtime: "node22",
      purpose: "workflow-serde-test",
    })
    expect(result.executed.sandboxInstance).toBe(true)
    expect(result.executed.sandboxId).toBe(sandboxId)
    expect(result.executed.result).toMatchObject({
      sandboxId,
      processId: `process_${sandboxId}`,
      streamId: `stream_${sandboxId}`,
      streamClientId: `sandbox-process:process_${sandboxId}`,
      success: true,
      exitCode: 0,
      output: `${runtime.env.marker}:${sandboxId}:pnpm test`,
      command: "pnpm test",
      status: "exited",
    })
  })
})
