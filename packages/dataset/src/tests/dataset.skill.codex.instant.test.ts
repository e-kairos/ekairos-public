/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { configureRuntime } from "@ekairos/domain/runtime"
import { createContext, eventsDomain, type ContextItem } from "@ekairos/events"
import { domain } from "@ekairos/domain"
import { datasetDomain } from "../schema"
import { DatasetService } from "../service"
import { buildDatasetSkillPackage } from "../skill"
import { createRealCodexCommandReactor, setupRealCodexRunner, type RealCodexRunner } from "./codex.real"
import { createTestApp, destroyTestApp } from "../../../ekairos-test/src/provision.ts"
import { attachMockInstantStreams } from "./_streams"

const fileDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(fileDir, "..", "..", "..", "..")

dotenvConfig({ path: path.resolve(repoRoot, ".env.local") })
dotenvConfig({ path: path.resolve(repoRoot, ".env") })

const TEST_TIMEOUT_MS = 12 * 60 * 1000

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

function hasCodexAuth(): boolean {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || path.join(homedir(), ".codex")
  return (
    existsSync(path.join(codexHome, "auth.json")) ||
    existsSync(path.join(codexHome, ".credentials.json"))
  )
}

function buildTriggerEvent(text: string): ContextItem {
  return {
    id: randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

function getCommandParts(event: ContextItem) {
  const parts = Array.isArray(event.content?.parts) ? event.content.parts : []
  return parts.filter((part: any) => part?.type === "tool-commandExecution")
}

function getCommandTexts(event: ContextItem): string[] {
  return getCommandParts(event).map((part: any) =>
    String(part?.input?.command ?? "").trim() + " " + JSON.stringify(part?.input?.commandActions ?? []),
  )
}

async function getOutputRows(db: any, datasetId: string) {
  const query: any = await db.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      dataFile: {},
    } as any,
  })
  const row = query.dataset_datasets?.[0]
  const linkedFile = Array.isArray(row?.dataFile) ? row.dataFile[0] : row?.dataFile
  const response = await fetch(linkedFile.url)
  const text = await response.text()
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry?.type === "row")
    .map((entry) => entry.data)
}

const sampleDomain = domain("sample").schema({
  entities: {
    sample_items: i.entity({
      name: i.string(),
      price: i.number(),
      category: i.string(),
      currency: i.string().optional(),
    }),
    sample_fx_rates: i.entity({
      currency: i.string(),
      usdRate: i.number(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-skill-codex-tests")
  .includes(datasetDomain)
  .includes(eventsDomain)
  .includes(sampleDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  repoPath: string
  approvalPolicy?: string
}

describe("dataset skill + codex real", () => {
  const realIt = getInstantProvisionToken() && hasCodexAuth() ? it : it.skip

  let appId: string | null = null
  let db: ReturnType<typeof init> | null = null
  let runner: RealCodexRunner | null = null
  let manifestPath = ""
  let tempRoot = ""

  const datasetSkill = buildDatasetSkillPackage()

  function createDatasetCodexContext(activeRunner: RealCodexRunner) {
    return createContext<TestEnv>("dataset.skill.codex.real")
      .context((stored) => stored.content ?? {})
      .narrative(
        () =>
          "Use installed skills when they are relevant. Persist the final dataset result when the task asks for a dataset.",
      )
      .skills(() => [datasetSkill as any])
      .actions(() => ({}))
      .reactor(createRealCodexCommandReactor<Record<string, unknown>, TestEnv>({ runner: activeRunner }))
      .shouldContinue(() => false)
      .build()
  }

  beforeAll(async () => {
    const app = await createTestApp({
      name: `dataset-skill-codex-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
      perms: {
        attrs: { allow: { create: "true" } },
        $files: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: { view: "isLoggedIn", create: "isLoggedIn" },
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
        sample_items: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "false",
            update: "false",
            delete: "false",
          },
        },
        sample_fx_rates: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "false",
            update: "false",
            delete: "false",
          },
        },
      } as any,
    })
    appId = app.appId
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
      schema: appDomain.toInstantSchema(),
    } as any)
    attachMockInstantStreams(db as any)

    configureRuntime({
      runtime: async () => ({ db } as any),
      domain: { domain: appDomain },
    })

    tempRoot = mkdtempSync(path.join(tmpdir(), "dataset-skill-codex-"))
    manifestPath = path.join(tempRoot, "runtime.json")
    runner = await setupRealCodexRunner({
      env: {
        EKAIROS_RUNTIME_MANIFEST_PATH: manifestPath,
      },
    })
  }, TEST_TIMEOUT_MS)

  afterAll(async () => {
    await runner?.dispose().catch(() => {})
    if (appId) {
      await destroyTestApp({ appId, token: getInstantProvisionToken() }).catch(() => {})
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)

  async function writeManifest() {
    const token = await db!.auth.createToken({ id: randomUUID() })
    const manifest = {
      version: 1,
      instant: {
        apiBaseUrl: "https://api.instantdb.com",
        appId: appId,
        token,
      },
      domain: {
        name: "dataset-skill-codex-tests",
        contextString: appDomain.contextString(),
        schemaJson: appDomain.toInstantSchema(),
      },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  }

  async function createRepo(prefix: string) {
    const repoPath = mkdtempSync(path.join(tempRoot, `${prefix}-repo-`))
    mkdirSync(path.join(repoPath, ".ekairos"), { recursive: true })
    return repoPath
  }

  async function runPrompt(params: { repoPath: string; prompt: string }) {
    const context = createDatasetCodexContext(runner!)
    return await context.react(buildTriggerEvent(params.prompt), {
      env: {
        repoPath: params.repoPath,
        approvalPolicy: "never",
      },
      context: { key: `dataset-skill:${Date.now()}:${Math.random().toString(36).slice(2)}` },
      durable: false,
      options: { maxIterations: 1, maxModelSteps: 1, silent: true },
    })
  }

  realIt(
    "file -> transform -> dataset final",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      await writeManifest()
      const repoPath = await createRepo("file")
      writeFileSync(
        path.join(repoPath, "input.csv"),
        ["code,description,price", "A1,Widget,10.5", "A2,Gadget,20"].join("\n"),
        "utf8",
      )

      const reaction = await runPrompt({
        repoPath,
        prompt: [
          "Create and persist a dataset with id codex_skill_file_v1 from the local file input.csv.",
          "The output rows must be objects with code, description, and numeric price.",
          "Persist the final dataset when done.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_file_v1")
      expect(rows).toEqual([
        { code: "A1", description: "Widget", price: 10.5 },
        { code: "A2", description: "Gadget", price: 20 },
      ])

      const commandTexts = getCommandTexts(reaction.reaction)
      expect(commandTexts.some((entry) => entry.includes("skills/dataset") && entry.includes("complete_dataset.mjs"))).toBe(true)
    },
  )

  realIt(
    "query -> transform -> dataset final",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      await writeManifest()
      const repoPath = await createRepo("query")
      const category = `electronics-${Date.now()}`
      await db!.transact([
        db!.tx.sample_items[newId()].update({
          name: "Widget",
          price: 10,
          category,
          currency: "USD",
        }),
        db!.tx.sample_items[newId()].update({
          name: "Gadget",
          price: 20,
          category,
          currency: "EUR",
        }),
      ])

      const reaction = await runPrompt({
        repoPath,
        prompt: [
          `Create and persist a dataset with id codex_skill_query_v1 from sample_items where category is ${category}.`,
          "Transform the result rows to objects with sku, price, and currency.",
          "sku must come from the item name field, not from the entity id.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_query_v1")
      expect(rows.sort((a, b) => String(a.sku).localeCompare(String(b.sku)))).toEqual([
        { sku: "Widget", price: 10, currency: "USD" },
        { sku: "Gadget", price: 20, currency: "EUR" },
      ].sort((a, b) => String(a.sku).localeCompare(String(b.sku))))

      const commandTexts = getCommandTexts(reaction.reaction)
      expect(commandTexts.some((entry) => entry.includes("query_to_jsonl.mjs"))).toBe(true)
      expect(commandTexts.some((entry) => entry.includes("complete_dataset.mjs"))).toBe(true)
    },
  )

  realIt(
    "multi-source -> transform -> dataset final",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      await writeManifest()
      const repoPath = await createRepo("multi")

      const sourceDatasetId = "codex_skill_source_v1"
      const service = new DatasetService(db as any)
      await service.createDataset({
        id: sourceDatasetId,
        title: "Source dataset",
        status: "completed",
        organizationId: "test-org",
      })
      const sourceJsonl = [
        JSON.stringify({ type: "row", data: { name: "Widget", price: 10, currency: "USD" } }),
        JSON.stringify({ type: "row", data: { name: "Gadget", price: 20, currency: "EUR" } }),
      ].join("\n") + "\n"
      await service.uploadDatasetOutputFile({
        datasetId: sourceDatasetId,
        fileBuffer: Buffer.from(sourceJsonl, "utf8"),
      })
      await service.updateDatasetStatus({
        datasetId: sourceDatasetId,
        status: "completed",
        calculatedTotalRows: 2,
        actualGeneratedRowCount: 2,
      })

      await db!.transact([
        db!.tx.sample_fx_rates[newId()].update({ currency: "USD", usdRate: 1 }),
        db!.tx.sample_fx_rates[newId()].update({ currency: "EUR", usdRate: 1.1 }),
      ])

      const reaction = await runPrompt({
        repoPath,
        prompt: [
          `Create and persist a dataset with id codex_skill_multi_v1 by joining source dataset ${sourceDatasetId} with sample_fx_rates.`,
          "Output rows must contain name and priceUsd.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_multi_v1")
      expect(rows).toEqual([
        { name: "Widget", priceUsd: 10 },
        { name: "Gadget", priceUsd: 22 },
      ])

      const commandTexts = getCommandTexts(reaction.reaction)
      expect(commandTexts.some((entry) => entry.includes("dataset_source_to_jsonl.mjs"))).toBe(true)
      expect(commandTexts.some((entry) => entry.includes("query_to_jsonl.mjs"))).toBe(true)
      expect(commandTexts.some((entry) => entry.includes("complete_dataset.mjs"))).toBe(true)
    },
  )
})
