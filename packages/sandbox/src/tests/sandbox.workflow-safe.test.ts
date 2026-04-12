/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { SandboxCommandRun, SandboxService, type SandboxServiceDbConfig } from "../service"
import type { CommandResult } from "../commands"

describe("sandbox workflow-safe handles", () => {
  const db: SandboxServiceDbConfig = {
    appId: "00000000-0000-0000-0000-000000000000",
    adminToken: "test-admin-token",
  }

  it("serializes and deserializes SandboxService from durable db config", () => {
    const service = new SandboxService({ config: db } as any)
    const serialized = (SandboxService as any)[WORKFLOW_SERIALIZE](service)

    expect(serialized).toEqual({ db })

    const restored = (SandboxService as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(SandboxService)
  })

  it("serializes command runs and keeps await semantics after deserialization", async () => {
    const result: CommandResult = {
      success: true,
      exitCode: 0,
      output: "ok",
      error: "",
      command: "echo ok",
    }
    const commandRun = new SandboxCommandRun({
      db,
      sandboxId: "sandbox-1",
      processId: "process-1",
      streamId: "stream-1",
      streamClientId: "sandbox-process:process-1",
      result,
    })

    const serialized = (SandboxCommandRun as any)[WORKFLOW_SERIALIZE](commandRun)
    expect(serialized).toMatchObject({
      db,
      sandboxId: "sandbox-1",
      processId: "process-1",
      streamId: "stream-1",
      streamClientId: "sandbox-process:process-1",
      result,
    })

    const restored = (SandboxCommandRun as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(SandboxCommandRun)
    expect(restored.processId).toBe("process-1")
    await expect(restored).resolves.toEqual(result)
  })
})
