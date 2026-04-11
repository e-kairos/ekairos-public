/* @vitest-environment node */

import { afterAll, describe, expect, it } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"

import { destroyTestApp } from "@ekairos/testing/provision"

import { runCli } from "../cli/index.js"

function hasInstantProvisionToken() {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim())
}

const describeCreateAppE2E = hasInstantProvisionToken() ? describe : describe.skip

async function reservePort() {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        rejectPort(new Error("Failed to reserve port"))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(port)
      })
    })
  })
}

async function waitForDomainEndpoint(baseUrl: string, timeoutMs = 2 * 60 * 1000) {
  const startedAt = Date.now()
  let lastError = ""

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/.well-known/ekairos/v1/domain`)
      if (response.ok) return
      lastError = `status:${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }

  throw new Error(`Timed out waiting for domain endpoint: ${lastError}`)
}

function createIo() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk
          return true
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk
          return true
        },
      },
    },
    read: () => ({ stdout, stderr }),
  }
}

describeCreateAppE2E("domain cli create-app", () => {
  const cleanup: Array<() => Promise<void>> = []

  afterAll(async () => {
    while (cleanup.length > 0) {
      const task = cleanup.pop()
      if (!task) continue
      await task().catch(() => {})
    }
  })

  it("scaffolds a Next app, provisions Instant, and serves the CLI loop end-to-end", async () => {
    const workspaceRoot = resolve(process.cwd(), "../..")
    const projectDir = await mkdtemp(join(tmpdir(), "ekairos-domain-create-app-"))
    cleanup.push(async () => {
      await rm(projectDir, { recursive: true, force: true }).catch(() => {})
    })

    const createIo = createIo()
    const createCode = await runCli(
      [
        "create-app",
        projectDir,
        "--next",
        "--install",
        "--force",
        "--package-manager=pnpm",
        `--workspace=${workspaceRoot}`,
        `--instantToken=${String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()}`,
      ],
      createIo.io as any,
    )

    expect(createCode, JSON.stringify(createIo.read())).toBe(0)
    const createPayload = JSON.parse(createIo.read().stdout)
    expect(createPayload.ok).toBe(true)
    expect(createPayload.data.provisioned).toBe(true)
    expect(typeof createPayload.data.appId).toBe("string")
    expect(typeof createPayload.data.adminToken).toBe("string")

    const appId = String(createPayload.data.appId)
    cleanup.push(async () => {
      if (!appId) return
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      }).catch(() => {})
    })

    const envFile = await readFile(join(projectDir, ".env.local"), "utf8")
    expect(envFile).toContain("NEXT_PUBLIC_INSTANT_APP_ID=")
    expect(envFile).toContain("INSTANT_ADMIN_TOKEN=")

    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const server = spawn(
      "pnpm",
      ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: projectDir,
        env: process.env,
        shell: process.platform === "win32",
        stdio: "pipe",
      },
    )

    let serverLogs = ""
    server.stdout.on("data", (chunk) => {
      serverLogs += chunk.toString()
    })
    server.stderr.on("data", (chunk) => {
      serverLogs += chunk.toString()
    })

    cleanup.push(async () => {
      if (server.exitCode !== null) return
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
          stdio: "ignore",
        })
      } else {
        server.kill("SIGTERM")
      }
    })

    await waitForDomainEndpoint(baseUrl).catch((error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${serverLogs}`,
      )
    })

    const seedIo = createIo()
    const seedCode = await runCli(
      ["seedDemo", "{}", `--baseUrl=${baseUrl}`, "--admin", "--pretty"],
      seedIo.io as any,
    )
    expect(seedCode, JSON.stringify(seedIo.read())).toBe(0)
    const seedPayload = JSON.parse(seedIo.read().stdout)
    expect(seedPayload.ok).toBe(true)
    expect(seedPayload.data.action).toBe("app.demo.seed")

    const queryIo = createIo()
    const queryCode = await runCli(
      [
        "query",
        "{ app_tasks: { comments: {} } }",
        `--baseUrl=${baseUrl}`,
        "--admin",
        "--meta",
        "--pretty",
      ],
      queryIo.io as any,
    )
    expect(queryCode, JSON.stringify(queryIo.read())).toBe(0)
    const queryPayload = JSON.parse(queryIo.read().stdout)
    expect(queryPayload.ok).toBe(true)
    expect(queryPayload.source).toBe("server")
    expect(Array.isArray(queryPayload.data.app_tasks)).toBe(true)
    expect(queryPayload.data.app_tasks.length).toBeGreaterThan(0)
    expect(Array.isArray(queryPayload.data.app_tasks[0].comments)).toBe(true)
    expect(queryPayload.data.app_tasks[0].comments.length).toBeGreaterThan(0)
  }, 10 * 60 * 1000)
})
