/* @vitest-environment node */

import { afterAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { config as dotenvConfig } from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { sandboxDomain } from "../actions"
import { SandboxService } from "../service"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

const fileDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(fileDir, "..", "..", "..", "..")

dotenvConfig({ path: path.resolve(repoRoot, ".env.local"), quiet: true })
dotenvConfig({ path: path.resolve(repoRoot, ".env"), quiet: true })

const TEST_TIMEOUT_MS = 5 * 60 * 1000

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

function hasSpritesEnv(): boolean {
  return Boolean(
    getInstantProvisionToken() &&
      String(process.env.SPRITES_API_TOKEN ?? process.env.SPRITE_TOKEN ?? "").trim(),
  )
}

function rows(result: unknown, key: string): Record<string, unknown>[] {
  const root = result && typeof result === "object" ? (result as Record<string, unknown>) : {}
  const value = root[key]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

describe("sandbox process streams with Sprites", () => {
  const testFn = hasSpritesEnv() ? it : it.skip
  const cleanup: Array<() => Promise<void>> = []

  afterAll(async () => {
    while (cleanup.length > 0) {
      const task = cleanup.pop()
      if (!task) continue
      await task().catch(() => {})
    }
  })

  testFn(
    "persists stdout stderr and exit chunks for a sandbox process",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const token = getInstantProvisionToken()
      const app = await createTestApp({
        name: `sandbox-process-stream-sprites-${Date.now()}`,
        token,
        schema: sandboxDomain.toInstantSchema(),
      })
      cleanup.push(async () => {
        await destroyTestApp({ appId: app.appId, token })
      })

      const db = init({
        appId: app.appId,
        adminToken: app.adminToken,
        schema: sandboxDomain.toInstantSchema(),
      } as any)
      const service = new SandboxService(db as any)
      let sandboxId: string | undefined

      try {
        const created = await service.createSandbox({
          provider: "sprites",
          runtime: "node22",
          purpose: "vitest-process-stream",
          sprites: {
            name: `ekairos-process-stream-${Date.now()}`,
            waitForCapacity: true,
            urlSettings: { auth: "public" },
            deleteOnStop: true,
          },
        })
        if (!created.ok) throw new Error(created.error)
        sandboxId = created.data.sandboxId

        const run = await service.runCommandWithProcessStream(
          sandboxId,
          "sh",
          ["-lc", "echo process-stdout; echo process-stderr 1>&2"],
          {
            kind: "command",
            mode: "foreground",
            cwd: "/home/sprite",
            metadata: { test: "sandbox.process-stream.sprites" },
          },
        )
        if (!run.ok) throw new Error(run.error)
        expect(run.data.result.exitCode).toBe(0)
        expect(run.data.streamClientId).toMatch(/^sandbox-process:/)
        expect(run.data.streamId).toBeTruthy()

        const stream = await service.readProcessStream(run.data.processId)
        if (!stream.ok) throw new Error(stream.error)
        const chunks = stream.data.chunks
        const chunkTypes = chunks.map((chunk) => chunk.type)
        expect(chunkTypes[0]).toBe("status")
        expect(chunkTypes).toContain("stdout")
        expect(chunkTypes[chunkTypes.length - 1]).toBe("exit")
        const stdoutText = chunks
          .filter((chunk) => chunk.type === "stdout")
          .map((chunk) => String(chunk.data?.text ?? ""))
          .join("")
        const stderrText = chunks
          .filter((chunk) => chunk.type === "stderr")
          .map((chunk) => String(chunk.data?.text ?? ""))
          .join("")
        expect(stdoutText).toContain("process-stdout")
        // Sprites currently returns stderr folded into stdout for this exec path.
        expect(`${stdoutText}\n${stderrText}`).toContain("process-stderr")
        const exitChunk = chunks[chunks.length - 1]
        expect(exitChunk?.data?.exitCode).toBe(0)
        expect(exitChunk?.data?.status).toBe("exited")

        const snapshot: any = await db.query({
          sandbox_processes: {
            $: { where: { id: run.data.processId as any }, limit: 1 },
            sandbox: {},
          },
        })
        const processRow = rows(snapshot, "sandbox_processes")[0]
        expect(processRow?.status).toBe("exited")
        expect(processRow?.kind).toBe("command")
        expect(processRow?.mode).toBe("foreground")
        expect(processRow?.exitCode).toBe(0)
        expect(processRow?.streamClientId).toBe(run.data.streamClientId)
        expect((processRow?.sandbox as any)?.id).toBe(sandboxId)
      } finally {
        if (sandboxId) {
          const stopped = await service.stopSandbox(sandboxId)
          if (!stopped.ok) throw new Error(stopped.error)
        }
      }
    },
  )
})
