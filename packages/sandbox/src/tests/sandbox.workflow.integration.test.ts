/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { start } from "workflow/api"

import { sandboxDomain } from "../schema"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"
import {
  sandboxProcessWorkflow,
  SandboxWorkflowTestRuntime,
} from "./sandbox.workflow-fixtures"

function getInstantProvisionToken() {
  const raw = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function hasSpritesWorkflowEnv(): boolean {
  return Boolean(
    getInstantProvisionToken() &&
      String(process.env.SPRITES_API_TOKEN ?? process.env.SPRITE_TOKEN ?? "").trim(),
  )
}

const describeWorkflowSprites = hasSpritesWorkflowEnv() ? describe : describe.skip

describeWorkflowSprites("sandbox service inside workflow/vitest", () => {
  let appId: string | null = null
  let adminToken: string | null = null

  beforeAll(async () => {
    const token = getInstantProvisionToken()
    const app = await createTestApp({
      name: `sandbox-workflow-${Date.now()}`,
      token,
      schema: sandboxDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({ appId, token: getInstantProvisionToken() }).catch(() => {})
    }
  }, 5 * 60 * 1000)

  it("creates a Sprite, streams a process, and awaits the command run inside workflow", async () => {
    const runtime = new SandboxWorkflowTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      marker: `sandbox-workflow-${Date.now()}`,
    })

    const run = await start(sandboxProcessWorkflow, [
      runtime,
      { spriteName: `ekairos-workflow-sandbox-${Date.now()}` },
    ])
    const result = await run.returnValue

    expect(result.sandboxId).toBeTruthy()
    expect(result.processId).toBeTruthy()
    expect(result.streamClientId).toMatch(/^sandbox-process:/)
    expect(result.result?.exitCode).toBe(0)
    expect(result.result?.success).toBe(true)
    expect(result.chunkTypes[0]).toBe("status")
    expect(result.chunkTypes).toContain("stdout")
    expect(result.chunkTypes[result.chunkTypes.length - 1]).toBe("exit")
    expect(result.stdoutText).toContain("workflow-sandbox-stdout")
    expect(`${result.stdoutText}\n${result.stderrText}`).toContain("workflow-sandbox-stderr")
  }, 5 * 60 * 1000)
})
