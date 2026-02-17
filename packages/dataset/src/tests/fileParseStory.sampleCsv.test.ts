import { it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { id, init } from "@instantdb/admin"
import { datasetDomain } from "../schema"
import { createFileParseStory } from "../file/file-dataset.agent"
import { configureDatasetTestRuntime } from "./_runtime"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "./_env"

// Load env from repo root (tests run with cwd = packages/dataset)
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await setupInstantTestEnv("dataset-file-parse")
if (hasInstantAdmin()) {
  await configureDatasetTestRuntime()
}

describeInstant("FileParseStory (sample.csv)", () => {
  function parseJsonl(text: string): any[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  }

  async function getOutputJsonlText(adminDb: any, datasetId: string): Promise<string> {
    const query: any = await adminDb.query({
      dataset_datasets: {
        $: { where: { id: datasetId } as any, limit: 1 },
        dataFile: {},
      } as any,
    })

    const dataset = query.dataset_datasets?.[0]
    const linkedFile = Array.isArray(dataset?.dataFile) ? dataset.dataFile[0] : dataset?.dataFile
    const url = linkedFile?.url
    expect(typeof url).toBe("string")
    const res = await fetch(url)
    expect(res.ok).toBe(true)
    return await res.text()
  }

  it("creates dataset for sample csv", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await fs.readFile(csvPath)

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: datasetDomain.toInstantSchema(),
    })

    const storagePath = `/tests/dataset/${Date.now()}-${Math.random().toString(16).slice(2)}.csv`
    const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })

    const fileId = uploadResult?.data?.id as string
    expect(fileId).toBeTruthy()

    const env = { orgId: "test-org" }
    const { datasetId } = await createFileParseStory<typeof env>(fileId, {
      instructions: "Create a dataset representing the raw file structure without transformations",
    }).parse(env)

    const datasetQuery: any = await adminDb.query({
      dataset_datasets: { $: { where: { id: datasetId } as any, limit: 1 } },
    })
    const dataset = datasetQuery.dataset_datasets?.[0]
    expect(dataset?.id).toBeTruthy()
    expect(dataset?.schema).toBeTruthy()

    const jsonlText = await getOutputJsonlText(adminDb, datasetId)
    const rows = parseJsonl(jsonlText)
      .filter((r) => r?.type === "row")
      .map((r) => r.data)

    expect(rows).toEqual([
      { code: "A1", description: "Widget", price: 10.5 },
      { code: "A2", description: "Gadget", price: 20 },
      { code: "A3", description: "Thing", price: 30.25 },
    ])

  }, 180000000)

  it("creates dataset with user instructions (renamed fields) and validates JSONL content", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await fs.readFile(csvPath)

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: datasetDomain.toInstantSchema(),
    })

    const storagePath = `/tests/dataset/${Date.now()}-${Math.random().toString(16).slice(2)}.csv`
    const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })

    const fileId = uploadResult?.data?.id as string
    expect(fileId).toBeTruthy()

    const env = { orgId: "test-org" }
    const { datasetId } = await createFileParseStory<typeof env>(fileId, {
      instructions: [
        "Rename fields and output only the renamed fields.",
        "",
        "- Map CSV column 'code' -> sku",
        "- Map CSV column 'description' -> name",
        "- Map CSV column 'price' -> unitPriceUsd (number)",
        "- Do NOT include the original field names in output (no code/description/price keys)",
      ].join("\n"),
    }).parse(env)

    const datasetQuery: any = await adminDb.query({
      dataset_datasets: { $: { where: { id: datasetId } as any, limit: 1 } },
    })
    const dataset = datasetQuery.dataset_datasets?.[0]
    expect(dataset?.id).toBeTruthy()

    const schemaProps = dataset?.schema?.schema?.properties
    expect(Boolean(schemaProps?.sku)).toBe(true)
    expect(Boolean(schemaProps?.name)).toBe(true)
    expect(Boolean(schemaProps?.unitPriceUsd)).toBe(true)
    expect(Boolean(schemaProps?.code)).toBe(false)
    expect(Boolean(schemaProps?.description)).toBe(false)
    expect(Boolean(schemaProps?.price)).toBe(false)

    const jsonlText = await getOutputJsonlText(adminDb, datasetId)
    const rows = parseJsonl(jsonlText)
      .filter((r) => r?.type === "row")
      .map((r) => r.data)

    expect(rows).toEqual([
      { sku: "A1", name: "Widget", unitPriceUsd: 10.5 },
      { sku: "A2", name: "Gadget", unitPriceUsd: 20 },
      { sku: "A3", name: "Thing", unitPriceUsd: 30.25 },
    ])
  }, 180000000)
})

