/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { config as dotenvConfig } from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promises as fs } from "node:fs"
import os from "node:os"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { sandboxDomain } from "../schema"
import { SandboxService } from "../service"

const execFileAsync = promisify(execFile)

const fileDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(fileDir, "..", "..", "..", "..")

// Load env from repo root (tests run with cwd = packages/sandbox)
dotenvConfig({ path: path.resolve(repoRoot, ".env.local") })
dotenvConfig({ path: path.resolve(repoRoot, ".env") })

const TEST_TIMEOUT_MS = 5 * 60 * 1000
const CLI_TIMEOUT_MS = 2 * 60 * 1000

function hasRequiredEnv(): boolean {
  const apiKey = String(process.env.DAYTONA_API_KEY ?? "").trim()
  const apiUrl =
    String(process.env.DAYTONA_SERVER_URL ?? "").trim() ||
    String(process.env.DAYTONA_API_URL ?? "").trim()
  const jwt = String(process.env.DAYTONA_JWT_TOKEN ?? "").trim()
  const org = String(process.env.DAYTONA_ORGANIZATION_ID ?? "").trim()

  if (!apiUrl) return false
  if (apiKey) return true
  return Boolean(jwt && org)
}

function resolveNpxCommand(): string {
  if (process.platform !== "win32") return "npx"
  return process.env.COMSPEC ?? "cmd.exe"
}

function parseInstantCliOutput(output: string): { appId: string; adminToken: string } {
  const raw = String(output ?? "").trim()
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("instant-cli output did not contain JSON")
  }

  const jsonStr = raw.slice(firstBrace, lastBrace + 1)
  const parsed = JSON.parse(jsonStr)
  if (parsed?.error) {
    throw new Error(`instant-cli error: ${String(parsed.error)}`)
  }

  const appId = String(parsed?.appId ?? parsed?.app?.appId ?? "")
  const adminToken = String(parsed?.adminToken ?? parsed?.app?.adminToken ?? "")
  if (!appId || !adminToken) {
    throw new Error("instant-cli output missing appId/adminToken")
  }

  return { appId, adminToken }
}

async function pushTempSchema(appId: string, adminToken: string): Promise<void> {
  const npxCmd = resolveNpxCommand()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekairos-sandbox-schema-"))
  const schemaPath = path.join(tempDir, "instant.schema.ts")
  const schemaSource = [
    "import { i } from \"@instantdb/core\";",
    "import { domain } from \"@ekairos/domain\";",
    "",
    "const sandboxDomain = domain(\"sandbox\").schema({",
    "  entities: {",
    "    sandbox_sandboxes: i.entity({",
    "      externalSandboxId: i.string().optional().indexed(),",
    "      provider: i.string().indexed(),",
    "      sandboxUrl: i.string().optional(),",
    "      status: i.string().indexed(),",
    "      timeout: i.number().optional(),",
    "      runtime: i.string().optional(),",
    "      vcpus: i.number().optional(),",
    "      ports: i.json().optional(),",
    "      purpose: i.string().optional().indexed(),",
    "      params: i.json().optional(),",
    "      createdAt: i.number().indexed(),",
    "      updatedAt: i.number().optional().indexed(),",
    "      shutdownAt: i.number().optional().indexed(),",
    "    }),",
    "  },",
    "  links: {},",
    "  rooms: {},",
    "});",
    "",
    "const appDomain = domain(\"sandbox-tests\")",
    "  .includes(sandboxDomain)",
    "  .schema({ entities: {}, links: {}, rooms: {} });",
    "",
    "const schema = appDomain.toInstantSchema();",
    "export default schema;",
    "",
  ].join("\n")

  await fs.writeFile(schemaPath, schemaSource, "utf-8")

  const baseArgs = [
    "instant-cli@latest",
    "push",
    "schema",
    "--app",
    appId,
    "--token",
    adminToken,
    "--yes",
  ]
  const args = process.platform === "win32" ? ["/c", "npx", ...baseArgs] : baseArgs

  try {
    await execFileAsync(npxCmd, args, {
      cwd: repoRoot,
      env: { ...process.env, INSTANT_SCHEMA_FILE_PATH: schemaPath },
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function createTempInstantApp(title: string): Promise<{ appId: string; adminToken: string }> {
  const npxCmd = resolveNpxCommand()
  const baseArgs = [
    "instant-cli@latest",
    "init-without-files",
    "--title",
    title,
    "--temp",
  ]
  const args =
    process.platform === "win32"
      ? ["/c", "npx", ...baseArgs]
      : baseArgs

  const { stdout, stderr } = await execFileAsync(npxCmd, args, {
    env: { ...process.env },
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  })

  const output = String(stdout ?? "").trim() || String(stderr ?? "").trim()
  return parseInstantCliOutput(output)
}

describe("sandbox temp-app smoke", () => {
  const testFn = hasRequiredEnv() ? it : it.skip

  testFn(
    "creates temp app, composes sandbox domain schema, runs a command",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const prevProvider = process.env.SANDBOX_PROVIDER
      process.env.SANDBOX_PROVIDER = "daytona"

      const title = `ekairos-sandbox-vitest-${Date.now()}`
      const { appId, adminToken } = await createTempInstantApp(title)
      await pushTempSchema(appId, adminToken)

      const appDomain = domain("sandbox-tests")
        .includes(sandboxDomain)
        .schema({ entities: {}, links: {}, rooms: {} })

      const db = init({
        appId,
        adminToken,
        schema: appDomain.toInstantSchema(),
      } as any)

      const service = new SandboxService(db as any)
      let sandboxId: string | undefined

      try {
        const created = await service.createSandbox({
          runtime: "node22",
          timeoutMs: 10 * 60 * 1000,
          purpose: "vitest-sandbox-smoke",
          params: { appId },
        })

        if (!created.ok) throw new Error(created.error)
        sandboxId = created.data.sandboxId

        const result = await service.runCommand(sandboxId, "node", ["-e", "console.log('sandbox-ok')"])
        if (!result.ok) throw new Error(result.error)

        expect(result.data.exitCode ?? 0).toBe(0)
        expect(result.data.output ?? "").toContain("sandbox-ok")
      } finally {
        if (prevProvider === undefined) {
          delete process.env.SANDBOX_PROVIDER
        } else {
          process.env.SANDBOX_PROVIDER = prevProvider
        }

        if (sandboxId) {
          const stopped = await service.stopSandbox(sandboxId)
          if (!stopped.ok) {
            throw new Error(stopped.error)
          }
        }
      }
    },
  )
})
