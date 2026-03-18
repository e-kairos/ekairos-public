/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { configureRuntime } from "@ekairos/domain/runtime"
import { domain } from "@ekairos/domain"
import { sandboxDomain } from "../schema"
import { SandboxService } from "../service"
import { buildDatasetSkillPackage } from "../../../dataset/src/skill"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

const fileDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(fileDir, "..", "..", "..", "..")

dotenvConfig({ path: path.resolve(repoRoot, ".env.local") })
dotenvConfig({ path: path.resolve(repoRoot, ".env") })

const TEST_TIMEOUT_MS = 8 * 60 * 1000

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

function hasVercelCliAuth(): boolean {
  return Boolean(getInstantProvisionToken())
}

describe("sandbox runtime-aware smoke", () => {
  const testFn = hasVercelCliAuth() ? it : it.skip

  testFn(
    "creates a runtime-aware Vercel sandbox and executes Instant query from inside the sandbox",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const prevProvider = process.env.SANDBOX_PROVIDER
      process.env.SANDBOX_PROVIDER = "vercel"

      const appDomain = domain("sandbox-tests")
        .includes(sandboxDomain)
        .schema({
          entities: {
            dataset_datasets: i.entity({
              datasetId: i.string().indexed(),
              sandboxId: i.string().optional().indexed(),
              title: i.string().optional(),
              status: i.string().optional().indexed(),
              organizationId: i.string().optional().indexed(),
              instructions: i.string().optional(),
              sources: i.json().optional(),
              sourceKinds: i.json().optional(),
              analysis: i.json().optional(),
              schema: i.json().optional(),
              createdAt: i.number().optional().indexed(),
              updatedAt: i.number().optional().indexed(),
            }),
            public_notes: i.entity({
              title: i.string(),
              createdAt: i.number(),
            }),
            private_notes: i.entity({
              title: i.string(),
              createdAt: i.number(),
            }),
          },
          links: {},
          rooms: {},
        })

      const perms = {
        attrs: {
          allow: {
            create: "true",
          },
        },
        dataset_datasets: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "isLoggedIn",
            update: "isLoggedIn",
            delete: "false",
          },
        },
        public_notes: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "isLoggedIn",
            update: "false",
            delete: "false",
          },
        },
        private_notes: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "false",
            create: "false",
            update: "false",
            delete: "false",
          },
        },
      }

      const app = await createTestApp({
        name: `ekairos-sandbox-runtime-aware-${Date.now()}`,
        token: getInstantProvisionToken(),
        schema: appDomain.toInstantSchema(),
        perms: perms as any,
      })

      const db = init({
        appId: app.appId,
        adminToken: app.adminToken,
        schema: appDomain.toInstantSchema(),
      } as any)

      configureRuntime({
        runtime: async () => ({ db } as any),
        domain: { domain: appDomain },
      })

      const seedIds = {
        publicId: randomUUID(),
        privateId: randomUUID(),
      }

      await db.transact([
        db.tx.public_notes[seedIds.publicId].update({
          title: "visible-from-sandbox",
          createdAt: Date.now(),
        }),
        db.tx.private_notes[seedIds.privateId].update({
          title: "hidden-from-sandbox",
          createdAt: Date.now(),
        }),
      ])

      const service = new SandboxService(db as any)
      let sandboxId: string | undefined

      try {
        const rejected = await service.createSandbox({
          provider: "sprites",
          env: { orgId: "sandbox-org" },
          domain: appDomain,
        })
        expect(rejected.ok).toBe(false)
        if (!rejected.ok) {
          expect(rejected.error).toContain("vercel")
        }

        const created = await service.createSandbox({
          provider: "vercel",
          runtime: "node22",
          timeoutMs: 10 * 60 * 1000,
          purpose: "vitest-sandbox-runtime-aware",
          vercel: {
            cwd: path.resolve(repoRoot, "packages", "registry"),
            scope: "ekairos-dev",
            environment: "development",
          },
          env: { orgId: "sandbox-org" },
          domain: appDomain,
          dataset: { enabled: true },
          skills: [buildDatasetSkillPackage()],
        })

        if (!created.ok) throw new Error(created.error)
        sandboxId = created.data.sandboxId

        const visible = await service.query(sandboxId, { public_notes: {} })
        if (!visible.ok) throw new Error(visible.error)
        expect(Array.isArray(visible.data.public_notes)).toBe(true)
        expect(visible.data.public_notes).toHaveLength(1)
        expect(visible.data.public_notes[0]?.title).toBe("visible-from-sandbox")

        const hidden = await service.query(sandboxId, { private_notes: {} })
        if (!hidden.ok) throw new Error(hidden.error)
        expect(Array.isArray(hidden.data.private_notes)).toBe(true)
        expect(hidden.data.private_notes).toHaveLength(0)

        const queryInputPath = "/vercel/sandbox/query-input.json"
        const queryOutputPath = "/vercel/sandbox/query-output.jsonl"
        const queryInput = {
          query: { public_notes: {} },
          outputPath: queryOutputPath,
          manifestPath: "/vercel/sandbox/.ekairos/runtime.json",
        }
        const inputWrite = await service.writeFiles(sandboxId, [
          {
            path: queryInputPath,
            contentBase64: Buffer.from(JSON.stringify(queryInput, null, 2), "utf8").toString("base64"),
          },
        ])
        if (!inputWrite.ok) throw new Error(inputWrite.error)

        const querySkill = await service.runCommand(sandboxId, "node", [
          "/vercel/sandbox/.codex/skills/dataset/code/query_to_jsonl.mjs",
          queryInputPath,
        ])
        if (!querySkill.ok) throw new Error(querySkill.error)
        expect(querySkill.data.exitCode ?? 0).toBe(0)

        const outputRead = await service.readFile(sandboxId, queryOutputPath)
        if (!outputRead.ok) throw new Error(outputRead.error)
        const outputText = Buffer.from(outputRead.data.contentBase64, "base64").toString("utf8")
        expect(outputText).toContain("visible-from-sandbox")

        const snapshot: any = await db.query({
          sandbox_sandboxes: {
            $: {
              where: { id: sandboxId } as any,
              limit: 1,
            },
            user: {},
          } as any,
        })

        const record = snapshot?.sandbox_sandboxes?.[0]
        const linkedUser = Array.isArray(record?.user) ? record.user[0] : record?.user

        expect(record?.sandboxUserId).toBeTruthy()
        expect(record?.sandboxUserId).toBe(linkedUser?.id ?? linkedUser?.["id"])
        expect(record?.params?.ekairos?.instant?.appId).toBe(app.appId)
        expect(record?.params?.ekairos?.bootstrap?.queryScriptPath).toBeTruthy()
        expect(record?.params?.ekairos?.dataset?.enabled).toBe(true)
        expect(record?.params?.ekairos?.domain?.schemaJson?.entities?.dataset_datasets).toBeTruthy()
        expect(Array.isArray(record?.params?.ekairos?.skills)).toBe(true)
        expect(record?.params?.ekairos?.skills?.[0]?.name).toBe("dataset")
        expect(record?.params?.ekairos?.scopedToken).toBeUndefined()
        expect(record?.params?.ekairos?.instant?.token).toBeUndefined()
        expect(JSON.stringify(record?.params ?? {})).not.toContain("as-token")
      } finally {
        if (sandboxId) {
          const stopped = await service.stopSandbox(sandboxId)
          if (!stopped.ok) {
            throw new Error(stopped.error)
          }
        }

        await destroyTestApp({
          appId: app.appId,
          token: getInstantProvisionToken(),
        }).catch(() => {})

        if (prevProvider === undefined) {
          delete process.env.SANDBOX_PROVIDER
        } else {
          process.env.SANDBOX_PROVIDER = prevProvider
        }
      }
    },
  )
})
