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
      const response = await fetch(`${baseUrl}/api/ekairos/domain`)
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
    // given: a temporary project directory and an Instant provisioning token.
    const workspaceRoot = resolve(process.cwd(), "../..")
    const projectDir = await mkdtemp(join(tmpdir(), "ekairos-domain-create-app-"))
    cleanup.push(async () => {
      await rm(projectDir, { recursive: true, force: true }).catch(() => {})
    })

    // when: create-app scaffolds a Next app with install and Instant
    // provisioning enabled.
    const createIoState = createIo()
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
        "--json",
      ],
      createIoState.io as any,
    )

    // then: the command reports a provisioned app without leaking the admin
    // token into JSON output.
    expect(createCode, JSON.stringify(createIoState.read())).toBe(0)
    const createPayload = JSON.parse(createIoState.read().stdout)
    expect(createPayload.ok).toBe(true)
    expect(createPayload.data.provisioned).toBe(true)
    expect(typeof createPayload.data.appId).toBe("string")
    expect(createPayload.data.adminToken).toBeUndefined()
    expect(createPayload.data.adminTokenWritten).toBe(true)
    expect(typeof createPayload.data.envFile).toBe("string")

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

    // when: the generated app starts its Next dev server.
    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const serverEnv = { ...process.env }
    delete serverEnv.NODE_ENV
    const server = spawn(
      "pnpm",
      ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: projectDir,
        env: serverEnv,
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

    // when: the generated CLI route executes the seeded supply-chain action.
    const launchIo = createIo()
    const launchCode = await runCli(
      [
        "supplyChain.order.launch",
        "{ reference: 'PO-E2E-7842', supplierName: 'Marula Components', sku: 'DRV-2048' }",
        `--baseUrl=${baseUrl}`,
        "--admin",
        "--pretty",
      ],
      launchIo.io as any,
    )

    // then: the action returns a successful domain action response.
    expect(launchCode, JSON.stringify(launchIo.read())).toBe(0)
    const launchPayload = JSON.parse(launchIo.read().stdout)
    expect(launchPayload.ok).toBe(true)
    expect(launchPayload.data.action).toBe("supplyChain.order.launch")

    // when: the CLI queries the generated nested procurement graph through the
    // server route.
    const queryIo = createIo()
    const queryCode = await runCli(
      [
        "query",
        "{ procurement_order: { supplier: {}, stockItems: {}, shipments: { inspections: {} } } }",
        `--baseUrl=${baseUrl}`,
        "--admin",
        "--meta",
        "--pretty",
      ],
      queryIo.io as any,
    )

    // then: the generated app returns linked order, stock item, shipment, and
    // inspection data.
    expect(queryCode, JSON.stringify(queryIo.read())).toBe(0)
    const queryPayload = JSON.parse(queryIo.read().stdout)
    expect(queryPayload.ok).toBe(true)
    expect(queryPayload.source).toBe("server")
    expect(Array.isArray(queryPayload.data.procurement_order)).toBe(true)
    expect(queryPayload.data.procurement_order.length).toBeGreaterThan(0)
    expect(Array.isArray(queryPayload.data.procurement_order[0].stockItems)).toBe(true)
    expect(queryPayload.data.procurement_order[0].stockItems.length).toBeGreaterThan(0)
    expect(Array.isArray(queryPayload.data.procurement_order[0].shipments)).toBe(true)
    expect(queryPayload.data.procurement_order[0].shipments.length).toBeGreaterThan(0)
    expect(Array.isArray(queryPayload.data.procurement_order[0].shipments[0].inspections)).toBe(true)
    expect(queryPayload.data.procurement_order[0].shipments[0].inspections.length).toBeGreaterThan(0)
  }, 10 * 60 * 1000)
})
