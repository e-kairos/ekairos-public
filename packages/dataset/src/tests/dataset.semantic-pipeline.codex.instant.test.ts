/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../../domain/src/runtime-handle.ts"
import { configureRuntime } from "@ekairos/domain/runtime"
import { createContext, didToolExecute, eventsDomain } from "@ekairos/events"
import { sandboxDomain, SandboxService } from "@ekairos/sandbox"
import { createCodexReactor, type CodexConfig } from "@ekairos/openai-reactor"
import { createTestApp } from "../../../ekairos-test/src/provision.ts"
import { tool } from "ai"
import { z } from "zod"
import { config as dotenvConfig } from "dotenv"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { DatasetService } from "../service"
import { datasetDomain } from "../schema"

dotenvConfig({ path: "C:/ek/.env.local", quiet: true })

const TEST_TIMEOUT_MS = 20 * 60 * 1000

const salesDomain = domain("sales").schema({
  entities: {
    sales_orders: i.entity({
      orderId: i.string().indexed(),
      regionId: i.string().indexed(),
      week: i.string().indexed(),
      amount: i.number(),
      status: i.string().indexed(),
    }),
    sales_regions: i.entity({
      regionId: i.string().indexed(),
      name: i.string(),
      country: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-semantic-pipeline")
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .includes(datasetDomain)
  .includes(salesDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = {
  orgId: string
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
  runtime?: SemanticPipelineRuntime
}

class SemanticPipelineRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb(env: TestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function rows(snapshot: any, key: string): any[] {
  return Array.isArray(snapshot?.[key]) ? snapshot[key] : []
}

function getInstantProvisionToken() {
  const raw = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function getCodexAuthPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  return join(codexHome, "auth.json")
}

function getCodexConfigPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  const configPath = join(codexHome, "config.toml")
  return existsSync(configPath) ? configPath : undefined
}

function hasRealEnv() {
  return Boolean(
    getInstantProvisionToken() &&
      String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TOKEN ?? process.env.VERCEL_OIDC_TOKEN ?? "").trim() &&
      existsSync(getCodexAuthPath()),
  )
}

function createUserEvent(text: string) {
  return {
    id: crypto.randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    status: "completed",
    content: { parts: [{ type: "text", text }] },
  } as any
}

function getMetadataOutput(result: any) {
  const parts = Array.isArray(result.reaction?.content?.parts) ? result.reaction.content.parts : []
  const metadataPart = parts.find((part: any) => part?.toolName === "turnMetadata")
  return metadataPart?.output ?? {}
}

async function createDatasetRows(
  service: DatasetService,
  params: {
    datasetId: string
    title: string
    rows: any[]
    sources?: any[]
    sourceKinds?: string[]
    analysis?: any
    schema?: any
    sandboxId?: string
  },
) {
  const created = await service.createDataset({
    id: params.datasetId,
    title: params.title,
    status: "completed",
    sources: params.sources ?? [],
    sourceKinds: params.sourceKinds ?? [],
    analysis: params.analysis ?? {},
    schema:
      params.schema ??
      ({
        title: `${params.datasetId}Row`,
        description: "Synthetic test dataset row",
        schema: { type: "object", additionalProperties: true },
      } as any),
    sandboxId: params.sandboxId,
    organizationId: "test-org",
  })
  if (!created.ok) throw new Error(created.error)
  const saved = await service.addDatasetRecords({
    datasetId: params.datasetId,
    records: params.rows.map((row, index) => ({ rowContent: row, order: index })),
  })
  if (!saved.ok) throw new Error(saved.error)
}

async function readDatasetRowsFromRecords(db: any, datasetId: string): Promise<any[]> {
  const snapshot: any = await db.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      records: {},
    } as any,
  })
  const dataset = rows(snapshot, "dataset_datasets")[0]
  const linkedRecords = Array.isArray(dataset?.records) ? dataset.records : []
  return linkedRecords
    .slice()
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((record: any) => record.rowContent)
}

function baseCodexConfig(env: TestEnv, sandboxId: string, purpose: string, bridgePort: number): CodexConfig {
  return {
    mode: "sandbox",
    appServerUrl: "sandbox://internal",
    repoPath: "/vercel/sandbox",
    approvalPolicy: "never",
    sandbox: {
      sandboxId,
      provider: "vercel",
      runtime: "node22",
      purpose,
      vercel: {
        profile: "ephemeral",
        deleteOnStop: false,
        cwd: "C:/ek",
        scope: "ekairos-dev",
      },
      authJsonPath: env.authJsonPath,
      configTomlPath: env.configTomlPath,
      createApp: false,
      installApp: false,
      startApp: false,
      checkpoint: false,
      bridgePort,
      appPort: 3000,
    },
  }
}

const describeReal = hasRealEnv() ? describe : describe.skip

describeReal("dataset semantic pipeline with Codex contexts", () => {
  let appId = ""
  let adminToken = ""
  let runtime: SemanticPipelineRuntime | null = null
  let db: ReturnType<typeof init> | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `dataset-semantic-pipeline-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new SemanticPipelineRuntime({
      orgId: "test-org",
      actorId: "dataset-pipeline-test-user",
      appId,
      adminToken,
      authJsonPath: getCodexAuthPath(),
      configTomlPath: getCodexConfigPath(),
    })
    db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db }),
    })

    const regions = [
      { regionId: "NOA", name: "NOA", country: "AR" },
      { regionId: "NEA", name: "NEA", country: "AR" },
      { regionId: "CABA", name: "CABA", country: "AR" },
    ]
    const orders: any[] = []
    for (let week = 1; week <= 4; week++) {
      for (const region of regions) {
        for (let n = 0; n < 5; n++) {
          orders.push({
            orderId: `O-${week}-${region.regionId}-${n}`,
            week: `S${week}`,
            regionId: region.regionId,
            amount: 10 * week + n + (region.regionId === "CABA" ? 20 : 0),
            status: n === 4 ? "refunded" : "paid",
          })
        }
      }
    }
    await db!.transact([
      ...regions.map((region) => db!.tx.sales_regions[newId()].update(region)),
      ...orders.map((order) => db!.tx.sales_orders[newId()].update(order)),
    ])

    const sandbox = await new SandboxService(db as any).createSandbox({
      provider: "vercel",
      runtime: "node22",
      timeoutMs: 20 * 60 * 1000,
      purpose: "dataset-semantic-pipeline",
      ports: [4520],
      vercel: {
        profile: "ephemeral",
        deleteOnStop: true,
        cwd: "C:/ek",
        scope: "ekairos-dev",
      },
    })
    if (!sandbox.ok) throw new Error(sandbox.error)
    sandboxId = sandbox.data.sandboxId
  }, 8 * 60 * 1000)

  afterAll(async () => {
    if (sandboxId && db) {
      await new SandboxService(db as any).stopSandbox(sandboxId).catch(() => {})
    }
  }, 5 * 60 * 1000)

  it("researches, resolves, and builds a verified dataset pipeline in one Codex context", async () => {
    if (!runtime || !db) throw new Error("runtime_not_initialized")
    const service = new DatasetService(db as any)
    const pipelineId = `pipeline-${Date.now()}`
    const calls: string[] = []

    const pipelineContext = createContext<TestEnv>("dataset.pipeline.semantic")
      .context((stored) => ({ ...(stored.content ?? {}), pipelineId }))
      .narrative(() =>
        [
          "You are an Ekairos Dataset pipeline worker.",
          "The domain is a semantic space. You must use the domain schema as formal context.",
          "Run the pipeline in this exact order: research, resolve, build.",
          "Research creates verified source datasets.",
          "Resolve creates the formal definition and the validated result dataset.",
          "Build creates the final MDX/component report.",
          "Call complete_research, then complete_resolution, then complete_build.",
        ].join("\n"),
      )
      .actions(() => ({
        complete_research: tool({
          description: "Materialize verified source datasets for the sales domain.",
          inputSchema: z.object({ summary: z.string() }),
          execute: async (input) => {
            calls.push("research")
            const snapshot: any = await db!.query({ sales_orders: {}, sales_regions: {} })
            const orders = rows(snapshot, "sales_orders")
            const regions = rows(snapshot, "sales_regions")
            const paidOrders = orders.filter((order) => order.status === "paid")
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_orders_paid`,
              title: "Paid orders source",
              rows: paidOrders,
              sources: [{ kind: "domain", domainName: "sales", entity: "sales_orders" }],
              sourceKinds: ["domain"],
              analysis: { summary: input.summary, citation: "sales.sales_orders" },
              sandboxId,
            })
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_regions`,
              title: "Regions source",
              rows: regions,
              sources: [{ kind: "domain", domainName: "sales", entity: "sales_regions" }],
              sourceKinds: ["domain"],
              analysis: { summary: "Region lookup", citation: "sales.sales_regions" },
              sandboxId,
            })
            return {
              researchId: `${pipelineId}_research`,
              datasets: [
                { datasetId: `${pipelineId}_orders_paid`, rows: paidOrders.length, citation: "sales.sales_orders" },
                { datasetId: `${pipelineId}_regions`, rows: regions.length, citation: "sales.sales_regions" },
              ],
            }
          },
        }),
        complete_resolution: tool({
          description: "Create the resolved dataset from researched source datasets.",
          inputSchema: z.object({
            explanation: z.string(),
            latex: z.string(),
          }),
          execute: async (input) => {
            calls.push("resolve")
            const ordersRows = await readDatasetRowsFromRecords(db, `${pipelineId}_orders_paid`)
            const regionRows = await readDatasetRowsFromRecords(db, `${pipelineId}_regions`)
            const regionById = new Map(regionRows.map((row: any) => [row.regionId, row.name]))
            const totals = new Map<string, any>()
            for (const order of ordersRows) {
              const key = `${order.week}:${order.regionId}`
              const current = totals.get(key) ?? {
                week: order.week,
                region: regionById.get(order.regionId) ?? order.regionId,
                totalAmount: 0,
              }
              current.totalAmount += Number(order.amount)
              totals.set(key, current)
            }
            const rowsOut = Array.from(totals.values()).sort((a, b) =>
              `${a.week}:${a.region}`.localeCompare(`${b.week}:${b.region}`),
            )
            const sourceTotal = ordersRows.reduce((sum: number, row: any) => sum + Number(row.amount), 0)
            const derivedTotal = rowsOut.reduce((sum: number, row: any) => sum + Number(row.totalAmount), 0)
            if (sourceTotal !== derivedTotal) throw new Error("sum_preserved_failed")
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_weekly_sales_by_region`,
              title: "Weekly sales by region",
              rows: rowsOut,
              sources: [
                { kind: "dataset", datasetId: `${pipelineId}_orders_paid` },
                { kind: "dataset", datasetId: `${pipelineId}_regions` },
              ],
              sourceKinds: ["dataset"],
              analysis: {
                explanation: input.explanation,
                latex: input.latex,
                checks: ["paid_only", "region_join_complete", "unique_week_region", "sum_preserved"],
              },
              sandboxId,
            })
            return {
              resolutionId: `${pipelineId}_resolution`,
              datasetId: `${pipelineId}_weekly_sales_by_region`,
              rowsProduced: rowsOut.length,
              checks: { sum_preserved: true, sourceTotal, derivedTotal },
            }
          },
        }),
        complete_build: tool({
          description: "Create final MDX presentation for a resolved dataset.",
          inputSchema: z.object({
            mdx: z.string(),
            explanation: z.string(),
          }),
          execute: async (input) => {
            calls.push("build")
            return {
              buildId: `${pipelineId}_build`,
              mdx: input.mdx,
              explanation: input.explanation,
              component: {
                name: "DatasetChart",
                props: { datasetId: `${pipelineId}_weekly_sales_by_region` },
              },
            }
          },
        }),
      }))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          resolveConfig: async ({ env }) => baseCodexConfig(env, sandboxId, "dataset-semantic-pipeline", 4520),
          includeStreamTraceInOutput: true,
          includeRawProviderChunksInOutput: true,
          maxPersistedStreamChunks: 1000,
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "complete_build"))
      .build()

    const run = await pipelineContext.react(
      createUserEvent(
        [
          "Build a verified dataset for weekly paid sales by region.",
          "Domain schema:",
          "sales_orders(orderId, regionId, week, amount, status)",
          "sales_regions(regionId, name, country)",
          "Call complete_research, complete_resolution, and complete_build in order.",
          "Use a formal latex definition in complete_resolution.",
          "The final MDX must include <DatasetChart datasetId=\"...\" />.",
        ].join("\n"),
      ),
      {
        runtime,
        context: { key: `${pipelineId}:semantic` },
        durable: false,
        options: { maxIterations: 3, maxModelSteps: 1, silent: false },
        env: { ...runtime.env, runtime } as any,
      } as any,
    )

    const finalRows = await readDatasetRowsFromRecords(db, `${pipelineId}_weekly_sales_by_region`)
    expect(finalRows).toHaveLength(12)
    expect(calls).toEqual(["research", "resolve", "build"])

    const snapshot: any = await db!.query({
      event_contexts: { $: { limit: 20 } },
      event_executions: { $: { limit: 20 } },
      event_steps: { $: { limit: 20, order: { createdAt: "asc" } } },
      event_items: { $: { limit: 50, order: { createdAt: "asc" } } },
      dataset_datasets: { $: { limit: 20, order: { createdAt: "asc" } } },
    } as any)

    const report = {
      appId,
      pipelineId,
      sandboxId,
      contexts: { semantic: run.context.id },
      calls,
      finalDatasetId: `${pipelineId}_weekly_sales_by_region`,
      finalRows,
      entities: snapshot,
    }
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `dataset-semantic-pipeline-codex-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[dataset-semantic-pipeline-codex] ${reportPath}`)
  }, TEST_TIMEOUT_MS)

  it.skip("can be split into explicit research, resolve, and build subcontexts", async () => {
    if (!runtime || !db) throw new Error("runtime_not_initialized")
    const service = new DatasetService(db as any)
    const pipelineId = `pipeline-${Date.now()}`
    const calls: string[] = []

    const researchContext = createContext<TestEnv>("dataset.pipeline.research")
      .context((stored) => ({ ...(stored.content ?? {}), pipelineId }))
      .narrative(() =>
        [
          "You are the research worker for Ekairos Dataset.",
          "The domain is a semantic space. Use domain schema and concrete rows to produce verified source datasets.",
          "Call complete_research once the source datasets are materialized.",
        ].join("\n"),
      )
      .actions((_, env) => ({
        complete_research: tool({
          description: "Materialize verified source datasets for the sales domain.",
          inputSchema: z.object({ summary: z.string() }),
          execute: async (input) => {
            calls.push("research")
            const snapshot: any = await db!.query({ sales_orders: {}, sales_regions: {} })
            const orders = rows(snapshot, "sales_orders")
            const regions = rows(snapshot, "sales_regions")
            const paidOrders = orders.filter((order) => order.status === "paid")
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_orders_paid`,
              title: "Paid orders source",
              rows: paidOrders,
              sources: [{ kind: "domain", domainName: "sales", entity: "sales_orders" }],
              sourceKinds: ["domain"],
              analysis: { summary: input.summary, citation: "sales.sales_orders" },
              sandboxId,
            })
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_regions`,
              title: "Regions source",
              rows: regions,
              sources: [{ kind: "domain", domainName: "sales", entity: "sales_regions" }],
              sourceKinds: ["domain"],
              analysis: { summary: "Region lookup", citation: "sales.sales_regions" },
              sandboxId,
            })
            return {
              researchId: `${pipelineId}_research`,
              datasets: [
                { datasetId: `${pipelineId}_orders_paid`, rows: paidOrders.length, citation: "sales.sales_orders" },
                { datasetId: `${pipelineId}_regions`, rows: regions.length, citation: "sales.sales_regions" },
              ],
            }
          },
        }),
      }))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          resolveConfig: async ({ env }) => baseCodexConfig(env, sandboxId, "dataset-research", 4520),
          includeStreamTraceInOutput: true,
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "complete_research"))
      .build()

    const research = await researchContext.react(
      createUserEvent(
        [
          "Research source datasets for weekly paid sales by region.",
          "Domain schema:",
          "sales_orders(orderId, regionId, week, amount, status)",
          "sales_regions(regionId, name, country)",
          "Call complete_research with a concise summary.",
        ].join("\n"),
      ),
      {
        runtime,
        context: { key: `${pipelineId}:research` },
        durable: false,
        options: { maxIterations: 1, maxModelSteps: 1, silent: false },
        env: { ...runtime.env, runtime } as any,
      } as any,
    )

    const resolveContext = createContext<TestEnv>("dataset.pipeline.resolve")
      .context((stored) => ({ ...(stored.content ?? {}), pipelineId }))
      .narrative(() =>
        [
          "You are the resolve worker for Ekairos Dataset.",
          "Resolve means produce the formal definition and validated extension of the dataset.",
          "Call complete_resolution once the definition and checks are clear.",
        ].join("\n"),
      )
      .actions(() => ({
        complete_resolution: tool({
          description: "Create the resolved dataset from researched source datasets.",
          inputSchema: z.object({
            explanation: z.string(),
            latex: z.string(),
          }),
          execute: async (input) => {
            calls.push("resolve")
            const ordersResult = await service.readRows({ datasetId: `${pipelineId}_orders_paid`, limit: 1000 })
            const regionsResult = await service.readRows({ datasetId: `${pipelineId}_regions`, limit: 1000 })
            if (!ordersResult.ok) throw new Error(ordersResult.error)
            if (!regionsResult.ok) throw new Error(regionsResult.error)
            const regionById = new Map(regionsResult.data.rows.map((row: any) => [row.regionId, row.name]))
            const totals = new Map<string, any>()
            for (const order of ordersResult.data.rows) {
              const key = `${order.week}:${order.regionId}`
              const current = totals.get(key) ?? {
                week: order.week,
                region: regionById.get(order.regionId) ?? order.regionId,
                totalAmount: 0,
              }
              current.totalAmount += Number(order.amount)
              totals.set(key, current)
            }
            const rowsOut = Array.from(totals.values()).sort((a, b) =>
              `${a.week}:${a.region}`.localeCompare(`${b.week}:${b.region}`),
            )
            const sourceTotal = ordersResult.data.rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0)
            const derivedTotal = rowsOut.reduce((sum: number, row: any) => sum + Number(row.totalAmount), 0)
            if (sourceTotal !== derivedTotal) throw new Error("sum_preserved_failed")
            await createDatasetRows(service, {
              datasetId: `${pipelineId}_weekly_sales_by_region`,
              title: "Weekly sales by region",
              rows: rowsOut,
              sources: [
                { kind: "dataset", datasetId: `${pipelineId}_orders_paid` },
                { kind: "dataset", datasetId: `${pipelineId}_regions` },
              ],
              sourceKinds: ["dataset"],
              analysis: {
                explanation: input.explanation,
                latex: input.latex,
                checks: ["paid_only", "region_join_complete", "unique_week_region", "sum_preserved"],
              },
              sandboxId,
            })
            return {
              resolutionId: `${pipelineId}_resolution`,
              datasetId: `${pipelineId}_weekly_sales_by_region`,
              rowsProduced: rowsOut.length,
              checks: { sum_preserved: true, sourceTotal, derivedTotal },
            }
          },
        }),
      }))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          resolveConfig: async ({ env }) => baseCodexConfig(env, sandboxId, "dataset-resolve", 4520),
          includeStreamTraceInOutput: true,
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "complete_resolution"))
      .build()

    const resolveRun = await resolveContext.react(
      createUserEvent(
        [
          `Use source datasets ${pipelineId}_orders_paid and ${pipelineId}_regions.`,
          "Resolve the dataset weekly sales by region.",
          "Call complete_resolution with a formal latex definition.",
        ].join("\n"),
      ),
      {
        runtime,
        context: { key: `${pipelineId}:resolve` },
        durable: false,
        options: { maxIterations: 1, maxModelSteps: 1, silent: false },
        env: { ...runtime.env, runtime } as any,
      } as any,
    )

    const buildContext = createContext<TestEnv>("dataset.pipeline.build")
      .context((stored) => ({ ...(stored.content ?? {}), pipelineId }))
      .narrative(() =>
        [
          "You are the build worker for Ekairos Dataset.",
          "Build a Streamdown/MDX answer with a custom component invocation for the resolved dataset.",
          "Call complete_build when ready.",
        ].join("\n"),
      )
      .actions(() => ({
        complete_build: tool({
          description: "Create final MDX presentation for a resolved dataset.",
          inputSchema: z.object({
            mdx: z.string(),
            explanation: z.string(),
          }),
          execute: async (input) => {
            calls.push("build")
            return {
              buildId: `${pipelineId}_build`,
              mdx: input.mdx,
              explanation: input.explanation,
              component: {
                name: "DatasetChart",
                props: { datasetId: `${pipelineId}_weekly_sales_by_region` },
              },
            }
          },
        }),
      }))
      .reactor(
        createCodexReactor<Record<string, unknown>, CodexConfig, TestEnv>({
          resolveConfig: async ({ env }) => baseCodexConfig(env, sandboxId, "dataset-build", 4520),
          includeStreamTraceInOutput: true,
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "complete_build"))
      .build()

    const buildRun = await buildContext.react(
      createUserEvent(
        [
          `Build an MDX report for dataset ${pipelineId}_weekly_sales_by_region.`,
          "Include <DatasetChart datasetId=\"...\" /> and cite the research datasets.",
          "Call complete_build.",
        ].join("\n"),
      ),
      {
        runtime,
        context: { key: `${pipelineId}:build` },
        durable: false,
        options: { maxIterations: 1, maxModelSteps: 1, silent: false },
        env: { ...runtime.env, runtime } as any,
      } as any,
    )

    const finalRows = await service.readRows({ datasetId: `${pipelineId}_weekly_sales_by_region`, limit: 100 })
    if (!finalRows.ok) throw new Error(finalRows.error)
    const expectedRows = 12
    expect(finalRows.data.rows).toHaveLength(expectedRows)
    expect(calls).toEqual(["research", "resolve", "build"])

    const snapshot: any = await db!.query({
      event_contexts: { $: { limit: 20, order: { createdAt: "asc" } } },
      event_executions: { $: { limit: 20, order: { createdAt: "asc" } } },
      event_steps: { $: { limit: 20, order: { createdAt: "asc" } } },
      event_items: { $: { limit: 50, order: { createdAt: "asc" } } },
      dataset_datasets: { $: { limit: 20, order: { createdAt: "asc" } } },
    } as any)

    const report = {
      appId,
      pipelineId,
      sandboxId,
      contexts: {
        research: research.context.id,
        resolve: resolveRun.context.id,
        build: buildRun.context.id,
      },
      calls,
      finalDatasetId: `${pipelineId}_weekly_sales_by_region`,
      finalRows: finalRows.data.rows,
      entities: snapshot,
    }
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `dataset-semantic-pipeline-codex-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[dataset-semantic-pipeline-codex] ${reportPath}`)
  }, TEST_TIMEOUT_MS)
})
