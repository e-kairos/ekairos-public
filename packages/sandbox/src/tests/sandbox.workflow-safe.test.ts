/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { SandboxCommandRun, SandboxService } from "../service"
import { SandboxWorkflowTestRuntime } from "./sandbox.workflow-fixtures"

describe("sandbox workflow-safe boundary", () => {
  const env = {
    appId: "00000000-0000-0000-0000-000000000000",
    adminToken: "test-admin-token",
    marker: "unit",
  }

  it("serializes the domain runtime instead of SandboxService", () => {
    const runtime = new SandboxWorkflowTestRuntime(env)
    const serialized = (SandboxWorkflowTestRuntime as any)[WORKFLOW_SERIALIZE](runtime)

    expect(serialized).toEqual({ env })

    const restored = (SandboxWorkflowTestRuntime as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(SandboxWorkflowTestRuntime)
    expect(restored.env).toEqual(env)
  })

  it("keeps node-backed service classes out of workflow serde", () => {
    expect((SandboxService as any)[WORKFLOW_SERIALIZE]).toBeUndefined()
    expect((SandboxService as any)[WORKFLOW_DESERIALIZE]).toBeUndefined()
    expect((SandboxCommandRun as any)[WORKFLOW_SERIALIZE]).toBeUndefined()
    expect((SandboxCommandRun as any)[WORKFLOW_DESERIALIZE]).toBeUndefined()
  })
})
