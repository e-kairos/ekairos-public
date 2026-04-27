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
import { configureRuntime, EkairosRuntime } from "@ekairos/domain/runtime"
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
const BENCHMARK_TIMINGS = process.env.EKAIROS_BENCHMARK_TIMINGS === "1"
const TRACE_REPORT = process.env.EKAIROS_DATASET_CODEX_TRACE_REPORT === "1"
const benchmarkEntries: Array<Record<string, unknown>> = []

function benchmarkLog(stage: string, data: Record<string, unknown>) {
  benchmarkEntries.push({ source: "dataset.skill", stage, ...data })
  if (!BENCHMARK_TIMINGS) return
  console.log(`[dataset-codex-benchmark] ${JSON.stringify({ source: "dataset.skill", stage, ...data })}`)
}

async function benchmarkAsync<T>(stage: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  try {
    return await run()
  } finally {
    benchmarkLog(stage, { ms: Date.now() - startedAt })
  }
}

function benchmarkSync<T>(stage: string, run: () => T): T {
  const startedAt = Date.now()
  try {
    return run()
  } finally {
    benchmarkLog(stage, { ms: Date.now() - startedAt })
  }
}

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
  return parts.filter((part: any) => {
    if (part?.type === "tool-commandExecution") return true

    const content = part?.content ?? {}
    return (
      part?.type === "action" &&
      content?.status === "started" &&
      content?.actionName === "sandbox_run_command"
    )
  })
}

function getCommandTexts(event: ContextItem): string[] {
  return getCommandParts(event).map((part: any) => {
    if (part?.type === "action") {
      const input = part?.content?.input ?? {}
      return String(input?.command ?? "").trim() + " " + JSON.stringify(input?.metadata?.commandActions ?? [])
    }

    return String(part?.input?.command ?? "").trim() + " " + JSON.stringify(part?.input?.commandActions ?? [])
  })
}

async function getOutputRows(db: any, datasetId: string, benchmarkLabel: string) {
  return await benchmarkAsync(`${benchmarkLabel}.getOutputRows`, async () => {
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
  })
}

async function queryEventParts(db: any, stepRows: any[]) {
  const rows: any[] = []
  for (const step of stepRows) {
    const stepId = String(step?.id ?? "").trim()
    if (!stepId) continue
    const snapshot = await db.query({
      event_parts: {
        $: {
          where: { stepId: stepId as any },
          order: { idx: "asc" },
          limit: 500,
        },
        step: {},
      },
    } as any)
    rows.push(...(Array.isArray(snapshot?.event_parts) ? snapshot.event_parts : []))
  }
  return rows
}

function redactTraceSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactTraceSecrets(entry))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /^(token|authorization|cookie|secret|password)$/i.test(key)
        ? "[REDACTED]"
        : redactTraceSecrets(entry)
    }
    return out
  }
  if (typeof value !== "string") return value
  return value
    .replace(/("(?:token|authorization|cookie|secret|password)"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"")
    .replace(/((?:as-token|authorization|cookie)\s*[:=]\s*)[^\s"'`,}]+/gi, "$1[REDACTED]")
}

async function writeTraceReport(params: {
  label: string
  appId: string | null
  db: any
  reaction: any
  rows: any[]
}) {
  if (!TRACE_REPORT) return

  const reportStartedAt = Date.now()
  const executionId = String(params.reaction?.execution?.id ?? "").trim()
  const contextId = String(params.reaction?.context?.id ?? "").trim()
  const reactionId = String(params.reaction?.reaction?.id ?? "").trim()
  const snapshot = await params.db.query({
    event_contexts: {
      $: { where: { id: contextId as any }, limit: 1 },
      currentExecution: {},
    },
    event_executions: {
      $: { where: { id: executionId as any }, limit: 1 },
      context: {},
      trigger: {},
      reaction: {},
    },
    event_steps: {
      $: {
        where: { "execution.id": executionId as any },
        order: { createdAt: "asc" },
        limit: 100,
      },
      execution: {},
      stream: {},
    },
    event_items: {
      $: {
        where: { "context.id": contextId as any },
        order: { createdAt: "asc" },
        limit: 100,
      },
      context: {},
      execution: {},
    },
    dataset_datasets: {
      $: { limit: 100, order: { createdAt: "asc" } },
      dataFile: {},
      records: {},
    },
  } as any)
  const stepRows = Array.isArray(snapshot?.event_steps) ? snapshot.event_steps : []
  const partRows = await queryEventParts(params.db, stepRows)
  const report = redactTraceSecrets({
    generatedAt: new Date().toISOString(),
    label: params.label,
    appId: params.appId,
    ids: { contextId, executionId, reactionId },
    timings: benchmarkEntries,
    outputRows: params.rows,
    reaction: params.reaction,
    counts: {
      event_contexts: Array.isArray(snapshot?.event_contexts) ? snapshot.event_contexts.length : 0,
      event_executions: Array.isArray(snapshot?.event_executions) ? snapshot.event_executions.length : 0,
      event_steps: stepRows.length,
      event_items: Array.isArray(snapshot?.event_items) ? snapshot.event_items.length : 0,
      event_parts: partRows.length,
      dataset_datasets: Array.isArray(snapshot?.dataset_datasets) ? snapshot.dataset_datasets.length : 0,
    },
    entities: {
      event_contexts: snapshot?.event_contexts ?? [],
      event_executions: snapshot?.event_executions ?? [],
      event_steps: stepRows,
      event_items: snapshot?.event_items ?? [],
      event_parts: partRows,
      dataset_datasets: snapshot?.dataset_datasets ?? [],
    },
  })
  const reportDir = path.resolve(process.cwd(), ".ekairos", "reports")
  mkdirSync(reportDir, { recursive: true })
  const reportPath = path.resolve(reportDir, `dataset-skill-codex-trace-${params.label}-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8")
  benchmarkLog(`${params.label}.writeTraceReport`, { ms: Date.now() - reportStartedAt, reportPath })
  console.log(`[dataset-skill-codex-trace] ${reportPath}`)
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

  class DatasetSkillRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
    protected getDomain() {
      return appDomain
    }

    protected resolveDb() {
      if (!db) throw new Error("dataset_skill_db_not_initialized")
      return db
    }
  }

  const datasetSkill = buildDatasetSkillPackage()

  function createDatasetCodexContext(activeRunner: RealCodexRunner, repoPath: string) {
    return createContext<TestEnv>("dataset.skill.codex.real")
      .context((stored) => stored.content ?? {})
      .narrative(
        () =>
          "Use installed skills when they are relevant. Persist the final dataset result when the task asks for a dataset.",
      )
      .skills(() => [datasetSkill as any])
      .actions(() => ({}))
      .reactor(createRealCodexCommandReactor<Record<string, unknown>, TestEnv>({
        runner: activeRunner,
        repoPath,
        approvalPolicy: "never",
      }))
      .shouldContinue(() => false)
      .build()
  }

  beforeAll(async () => {
    const app = await benchmarkAsync("beforeAll.createTestApp", async () =>
      await createTestApp({
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
      }),
    )
    appId = app.appId
    benchmarkSync("beforeAll.configureRuntime", () => {
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
    })

    benchmarkSync("beforeAll.createTempRoot", () => {
      tempRoot = mkdtempSync(path.join(tmpdir(), "dataset-skill-codex-"))
      manifestPath = path.join(tempRoot, "runtime.json")
    })
    runner = await benchmarkAsync("beforeAll.setupRealCodexRunner", async () =>
      await setupRealCodexRunner({
        env: {
          EKAIROS_RUNTIME_MANIFEST_PATH: manifestPath,
        },
      }),
    )
  }, TEST_TIMEOUT_MS)

  afterAll(async () => {
    await benchmarkAsync("afterAll.disposeRunner", async () => {
      await runner?.dispose().catch(() => {})
    })
    if (appId) {
      await benchmarkAsync("afterAll.destroyTestApp", async () => {
        await destroyTestApp({ appId: appId!, token: getInstantProvisionToken() }).catch(() => {})
      })
    }
    if (tempRoot) {
      benchmarkSync("afterAll.removeTempRoot", () => {
        rmSync(tempRoot, { recursive: true, force: true })
      })
    }
  }, TEST_TIMEOUT_MS)

  async function writeManifest(benchmarkLabel: string) {
    await benchmarkAsync(`${benchmarkLabel}.writeManifest`, async () => {
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
    })
  }

  async function createRepo(prefix: string) {
    return benchmarkSync(`${prefix}.createRepo`, () => {
      const repoPath = mkdtempSync(path.join(tempRoot, `${prefix}-repo-`))
      mkdirSync(path.join(repoPath, ".ekairos"), { recursive: true })
      return repoPath
    })
  }

  async function runPrompt(params: { repoPath: string; prompt: string; benchmarkLabel: string }) {
    return await benchmarkAsync(`${params.benchmarkLabel}.runPrompt`, async () => {
      const context = createDatasetCodexContext(runner!, params.repoPath)
      const env = {
        repoPath: params.repoPath,
        approvalPolicy: "never",
      }
      const shell = await context.react(buildTriggerEvent(params.prompt), {
        runtime: new DatasetSkillRuntime(env),
        env,
        context: { key: `dataset-skill:${Date.now()}:${Math.random().toString(36).slice(2)}` },
        durable: false,
        options: { maxIterations: 1, maxModelSteps: 1, silent: true },
      })
      return await shell.run!
    })
  }

  realIt(
    "file -> transform -> dataset final",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      await writeManifest("file")
      const repoPath = await createRepo("file")
      benchmarkSync("file.seedInputFile", () => {
        writeFileSync(
          path.join(repoPath, "input.csv"),
          ["code,description,price", "A1,Widget,10.5", "A2,Gadget,20"].join("\n"),
          "utf8",
        )
      })

      const reaction = await runPrompt({
        repoPath,
        benchmarkLabel: "file",
        prompt: [
          "Create and persist a dataset with id codex_skill_file_v1 from the local file input.csv.",
          "The output rows must be objects with code, description, and numeric price.",
          "Persist the final dataset when done.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_file_v1", "file")
      expect(rows).toEqual([
        { code: "A1", description: "Widget", price: 10.5 },
        { code: "A2", description: "Gadget", price: 20 },
      ])

      const commandTexts = getCommandTexts(reaction.reaction)
      expect(commandTexts.some((entry) => entry.includes("skills/dataset") && entry.includes("complete_dataset.mjs"))).toBe(true)
      await writeTraceReport({ label: "file", appId, db, reaction, rows })
    },
  )

  realIt(
    "query -> transform -> dataset final",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      await writeManifest("query")
      const repoPath = await createRepo("query")
      const category = `electronics-${Date.now()}`
      await benchmarkAsync("query.seedItems", async () => {
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
      })

      const reaction = await runPrompt({
        repoPath,
        benchmarkLabel: "query",
        prompt: [
          `Create and persist a dataset with id codex_skill_query_v1 from sample_items where category is ${category}.`,
          "Transform the result rows to objects with sku, price, and currency.",
          "sku must come from the item name field, not from the entity id.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_query_v1", "query")
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
      await writeManifest("multi")
      const repoPath = await createRepo("multi")

      const sourceDatasetId = "codex_skill_source_v1"
      const service = new DatasetService(db as any)
      const sourceJsonl = [
        JSON.stringify({ type: "row", data: { name: "Widget", price: 10, currency: "USD" } }),
        JSON.stringify({ type: "row", data: { name: "Gadget", price: 20, currency: "EUR" } }),
      ].join("\n") + "\n"
      await benchmarkAsync("multi.seedSourceDataset", async () => {
        await service.createDataset({
          id: sourceDatasetId,
          title: "Source dataset",
          status: "completed",
          organizationId: "test-org",
        })
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
      })

      await benchmarkAsync("multi.seedFxRates", async () => {
        await db!.transact([
          db!.tx.sample_fx_rates[newId()].update({ currency: "USD", usdRate: 1 }),
          db!.tx.sample_fx_rates[newId()].update({ currency: "EUR", usdRate: 1.1 }),
        ])
      })

      const reaction = await runPrompt({
        repoPath,
        benchmarkLabel: "multi",
        prompt: [
          `Create and persist a dataset with id codex_skill_multi_v1 by joining source dataset ${sourceDatasetId} with sample_fx_rates.`,
          "Output rows must contain name and priceUsd.",
        ].join(" "),
      })

      const rows = await getOutputRows(db, "codex_skill_multi_v1", "multi")
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
