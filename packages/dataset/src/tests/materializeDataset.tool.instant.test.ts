import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "path"
import { readFile } from "fs/promises"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { configureRuntime, EkairosRuntime } from "@ekairos/domain/runtime"
import { createScriptedReactor, eventsDomain } from "@ekairos/events"
import { sandboxDomain, SandboxService } from "@ekairos/sandbox"
import { createMaterializeDatasetTool } from "../materializeDataset.tool"
import { getDatasetOutputPath, getDatasetWorkstation } from "../datasetFiles"
import { datasetDomain } from "../schema"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "./_env"
import { attachMockInstantStreams } from "./_streams"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const registryVercelCwd = path.resolve(__dirname, "..", "..", "..", "registry")

const sampleDomain = domain("sample").schema({
  entities: {
    sample_items: i.entity({
      name: i.string(),
      price: i.number(),
      category: i.string(),
      currency: i.string().optional(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-tool-tests")
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .includes(eventsDomain)
  .includes(sampleDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

await setupInstantTestEnv("materialize-dataset-tool", appDomain.toInstantSchema(), {
  preferExistingApp: false,
})

const adminDb =
  hasInstantAdmin()
    ? init({
        appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
        adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
        schema: appDomain.toInstantSchema(),
      } as any)
    : null

if (adminDb) {
  attachMockInstantStreams(adminDb)
}

if (adminDb) {
  configureRuntime({
    domain: { domain: appDomain },
    runtime: async () => ({ db: adminDb } as any),
  })
}

type TestEnv = Record<string, unknown> & {
  orgId: string
}

class MaterializeDatasetToolTestRuntime extends EkairosRuntime<TestEnv, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return adminDb as any
  }
}

const testRuntime = new MaterializeDatasetToolTestRuntime({ orgId: "test-org" })

function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function getOutputRows(datasetId: string) {
  const query: any = await adminDb!.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      dataFile: {},
    } as any,
  })
  const row = query.dataset_datasets?.[0]
  const linkedFile = Array.isArray(row?.dataFile) ? row.dataFile[0] : row?.dataFile
  const response = await fetch(linkedFile.url)
  return parseJsonl(await response.text()).filter((entry) => entry?.type === "row").map((entry) => entry.data)
}

async function seedRows(categorySuffix?: string) {
  const electronicsCategory = `electronics${categorySuffix ? `-${categorySuffix}` : ""}`
  const item1 = newId()
  const item2 = newId()
  await adminDb!.transact([
    adminDb!.tx.sample_items[item1].update({
      name: `Widget-${Date.now()}`,
      price: 10,
      category: electronicsCategory,
      currency: "USD",
    }),
    adminDb!.tx.sample_items[item2].update({
      name: `Gadget-${Date.now()}`,
      price: 20,
      category: electronicsCategory,
      currency: "EUR",
    }),
  ])
  return { electronicsCategory }
}

async function createTestSandbox() {
  const service = new SandboxService(adminDb as any)
  const created = await service.createSandbox({
    provider: "vercel",
    runtime: "python3.13",
    timeoutMs: 10 * 60 * 1000,
    purpose: "dataset.tool.tests",
    vercel: {
      cwd: registryVercelCwd,
      scope: "ekairos-dev",
      environment: "development",
    },
    env: { orgId: "test-org" },
    domain: appDomain,
    dataset: { enabled: true },
  })
  if (!created.ok) throw new Error(created.error)
  return created.data.sandboxId
}

async function stopTestSandbox(sandboxId?: string) {
  if (!sandboxId) return
  const service = new SandboxService(adminDb as any)
  await service.stopSandbox(sandboxId)
}

function scriptedToolStep(toolName: string, input: Record<string, unknown>, text = `call ${toolName}`) {
  const toolCallId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    assistantEvent: {
      content: {
        parts: [
          { type: "text", text },
          {
            type: `tool-${toolName}`,
            toolCallId,
            input,
          },
        ],
      },
    },
    actionRequests: [
      {
        actionRef: toolCallId,
        actionName: toolName,
        input,
      },
    ],
    messagesForModel: [],
  }
}

describeInstant("createMaterializeDatasetTool()", () => {
  let suiteSandboxId: string | undefined

  beforeAll(async () => {
    suiteSandboxId = await createTestSandbox()
  }, 120000)

  afterAll(async () => {
    await stopTestSandbox(suiteSandboxId)
    suiteSandboxId = undefined
  }, 120000)

  it("materializes a query snapshot and returns only datasetId", async () => {
    const { electronicsCategory } = await seedRows(`tool-snapshot-${Date.now()}`)
    const materializeTool = createMaterializeDatasetTool({
      runtime: testRuntime,
      queryDomain: sampleDomain,
    })

    const output = await (materializeTool as any).execute({
      datasetId: "tool_query_snapshot_v1",
      sources: [
        {
          kind: "query",
          query: {
            sample_items: {
              $: {
                where: { category: electronicsCategory },
                fields: ["name", "price", "currency"],
                limit: 10,
              },
            },
          },
          title: "electronics",
          explanation: "snapshot",
        },
      ],
    })

    expect(output).toEqual({ datasetId: "tool_query_snapshot_v1" })
    expect((await getOutputRows("tool_query_snapshot_v1")).length).toBe(2)
    const query: any = await adminDb!.query({
      dataset_datasets: {
        $: { where: { datasetId: "tool_query_snapshot_v1" } as any, limit: 1 },
      },
    })
    expect(query.dataset_datasets?.[0]?.sandboxId ?? null).toBeNull()
  })

  it("materializes a file-derived dataset through the declarative tool", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const uploadResult = await adminDb!.storage.uploadFile(`/tests/dataset/${Date.now()}-tool-file.csv`, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

    const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep(
          "executeCommand",
          {
            scriptName: "parse_csv_to_jsonl",
            pythonCode: [
              "import csv, glob, json",
              `workstation = ${JSON.stringify(getDatasetWorkstation("tool_file_v1"))}`,
              `output_path = ${JSON.stringify(getDatasetOutputPath("tool_file_v1"))}`,
              "source_path = glob.glob(workstation + '/*.csv')[0]",
              "with open(source_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
              "  reader = csv.DictReader(src)",
              "  for row in reader:",
              "    payload = {'type': 'row', 'data': {'code': row['code'], 'description': row['description'], 'price': float(row['price'])}}",
              "    out.write(json.dumps(payload) + '\\n')",
              "print('file materialized')",
            ].join("\n"),
          },
        ),
        scriptedToolStep("completeDataset", { summary: "file ready" }),
      ],
    })

    const materializeTool = createMaterializeDatasetTool({
      runtime: testRuntime,
      reactor,
      queryDomain: sampleDomain,
    })

    const output = await (materializeTool as any).execute({
      datasetId: "tool_file_v1",
      sandboxId: suiteSandboxId!,
      schema: {
        title: "ProductRecord",
        description: "One product row",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            description: { type: "string" },
            price: { type: "number" },
          },
          required: ["code", "description", "price"],
        },
      },
      sources: [{ kind: "file", fileId, description: "source csv" }],
    })

    expect(output).toEqual({ datasetId: "tool_file_v1" })
    expect((await getOutputRows("tool_file_v1")).length).toBe(3)
  }, 240000)

  it("throws when a file scenario is invoked without sandboxId", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const uploadResult = await adminDb!.storage.uploadFile(`/tests/dataset/${Date.now()}-tool-file-no-reactor.csv`, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

    const materializeTool = createMaterializeDatasetTool({
      runtime: testRuntime,
      queryDomain: sampleDomain,
    })

    await expect(
      (materializeTool as any).execute({
        datasetId: "tool_file_no_sandbox_v1",
        sources: [{ kind: "file", fileId }],
      }),
    ).rejects.toThrow("dataset_sandbox_required")
  })

  it("throws when a file scenario has sandboxId but no reactor", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const uploadResult = await adminDb!.storage.uploadFile(`/tests/dataset/${Date.now()}-tool-file-no-reactor.csv`, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

    const materializeTool = createMaterializeDatasetTool({
      runtime: testRuntime,
      queryDomain: sampleDomain,
    })

    await expect(
      (materializeTool as any).execute({
        datasetId: "tool_file_no_reactor_v1",
        sandboxId: suiteSandboxId!,
        sources: [{ kind: "file", fileId }],
      }),
    ).rejects.toThrow("dataset_reactor_required")
  })

  it("throws when first=true produces more than one row", async () => {
    const { electronicsCategory } = await seedRows(`tool-first-${Date.now()}`)
    const materializeTool = createMaterializeDatasetTool({
      runtime: testRuntime,
      queryDomain: sampleDomain,
    })

    await expect(
      (materializeTool as any).execute({
        datasetId: "tool_first_fail_v1",
        first: true,
        sources: [
          {
            kind: "query",
            query: {
              sample_items: {
                $: {
                  where: { category: electronicsCategory },
                  fields: ["name", "price"],
                  limit: 10,
                },
              },
            },
          },
        ],
      }),
    ).rejects.toThrow("dataset_first_expected_zero_or_one_row")
  })
})
