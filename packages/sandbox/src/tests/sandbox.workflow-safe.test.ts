/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { createContextPartSchema } from "@ekairos/events"

import { Sandbox } from "../sandbox"
import { sandboxDomain } from "../actions"
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

  it("serializes a multiprovider sandbox handle with its runtime", () => {
    const runtime = new SandboxWorkflowTestRuntime(env)
    const sandbox = Sandbox.from(runtime, {
      version: 1,
      sandboxId: "sandbox_123",
      provider: "sprites",
      externalSandboxId: "sprite_123",
      runtime: "node22",
      ports: [3000],
      purpose: "unit-test",
    })

    const serialized = (Sandbox as any)[WORKFLOW_SERIALIZE](sandbox)

    expect(serialized).toEqual({
      runtime,
      state: {
        version: 1,
        sandboxId: "sandbox_123",
        provider: "sprites",
        externalSandboxId: "sprite_123",
        runtime: "node22",
        ports: [3000],
        purpose: "unit-test",
      },
    })

    const restored = (Sandbox as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(Sandbox)
    expect(restored.sandboxId).toBe("sandbox_123")
    expect(restored.state).toEqual(serialized.state)
  })

  it("exposes sandbox_run_command actions and matching context parts", () => {
    const runtime = new SandboxWorkflowTestRuntime(env)
    const sandbox = Sandbox.from(runtime, {
      version: 1,
      sandboxId: "sandbox_123",
      provider: "sprites",
    })
    const actions = sandbox.actions()

    expect(Object.keys(actions)).toEqual([Sandbox.runCommandActionName])
    expect(
      Sandbox.runCommandInputSchema.parse({
        command: "pnpm",
        args: ["test"],
        cwd: "/workspace/app",
      }),
    ).toEqual({
      command: "pnpm",
      args: ["test"],
      cwd: "/workspace/app",
    })
    expect(() =>
      Sandbox.runCommandInputSchema.parse({
        sandboxId: "sandbox_123",
        command: "pnpm",
      }),
    ).toThrow()
    expect(
      Sandbox.runCommandOutputSchema.parse({
        sandboxId: "sandbox_123",
        success: true,
        exitCode: 0,
        output: "ok",
      }),
    ).toEqual({
      sandboxId: "sandbox_123",
      success: true,
      exitCode: 0,
      output: "ok",
    })

    const partSchema = createContextPartSchema(actions)
    expect(
      partSchema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: Sandbox.runCommandActionName,
          actionCallId: "call_1",
          input: {
            command: "pnpm",
            args: ["test"],
          },
        },
      }),
    ).toMatchObject({
      type: "action",
      content: {
        status: "started",
        actionName: Sandbox.runCommandActionName,
      },
    })
    expect(() =>
      partSchema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: Sandbox.runCommandActionName,
          actionCallId: "call_1",
          input: {
            sandboxId: "sandbox_123",
            command: "pnpm",
          },
        },
      }),
    ).toThrow()
    expect(
      partSchema.parse({
        type: "action",
        content: {
          status: "completed",
          actionName: Sandbox.runCommandActionName,
          actionCallId: "call_1",
          output: {
            success: true,
            exitCode: 0,
            output: "ok",
          },
        },
      }),
    ).toMatchObject({
      type: "action",
      content: {
        status: "completed",
        actionName: Sandbox.runCommandActionName,
      },
    })
    expect(() =>
      partSchema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: "sandbox_unknown",
          actionCallId: "call_2",
          input: { command: "pwd" },
        },
      }),
    ).toThrow()
  })

  it("executes exposed sandbox actions through the domain with sandboxId bound", async () => {
    const useCalls: unknown[] = []
    const commandCalls: unknown[] = []
    const runtime = {
      env,
      use: async (domain: unknown) => {
        useCalls.push(domain)
        return {
          actions: {
            runCommandProcess: async (input: unknown) => {
              commandCalls.push(input)
              return {
                ok: true,
                data: {
                  processId: "process_123",
                  streamId: "stream_123",
                  streamClientId: "sandbox-process:process_123",
                  result: {
                    success: true,
                    exitCode: 0,
                    output: "ok\n",
                    command: "pnpm test",
                  },
                },
              }
            },
          },
        }
      },
    }
    const sandbox = Sandbox.from(runtime as any, {
      version: 1,
      sandboxId: "sandbox_123",
      provider: "sprites",
    })

    const result = await sandbox.actions()[Sandbox.runCommandActionName].execute(
      {
        command: "pnpm",
        args: ["test"],
        cwd: "/workspace/app",
        metadata: { reason: "unit" },
      },
      {} as any,
    )

    expect(useCalls).toEqual([sandboxDomain])
    expect(commandCalls).toEqual([
      {
        sandboxId: "sandbox_123",
        command: "pnpm",
        args: ["test"],
        cwd: "/workspace/app",
        kind: "command",
        mode: "foreground",
        metadata: {
          source: "sandbox.action",
          reason: "unit",
        },
      },
    ])
    expect(result).toEqual({
      sandboxId: "sandbox_123",
      processId: "process_123",
      streamId: "stream_123",
      streamClientId: "sandbox-process:process_123",
      success: true,
      exitCode: 0,
      output: "ok\n",
      command: "pnpm test",
      status: "exited",
    })
  })
})
