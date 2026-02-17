import { it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "path"
import { readFile } from "fs/promises"
import { init } from "@instantdb/admin"
import { datasetDomain } from "../schema"
import { createFileParseStory } from "../file/file-dataset.agent"
import { createTransformDatasetStory } from "../transform/transform-dataset.agent"
import { configureDatasetTestRuntime } from "./_runtime"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "./_env"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await setupInstantTestEnv("dataset-transform")
if (hasInstantAdmin()) {
  await configureDatasetTestRuntime()
}

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

describeInstant("TransformDatasetStory (sample.csv)", () => {
  it("transforms parsed dataset into a new schema and validates JSONL content", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: datasetDomain.toInstantSchema(),
    })

    // Upload CSV as file input
    const storagePath = `/tests/dataset/${Date.now()}-${Math.random().toString(16).slice(2)}.csv`
    const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string
    expect(fileId).toBeTruthy()

    const env = { orgId: "test-org" }

    // 1) Create source dataset from file
    const { datasetId: sourceDatasetId } = await createFileParseStory<typeof env>(fileId, {
      instructions: "Create a dataset representing the raw file structure without transformations",
    }).parse(env)

    // 2) Transform source dataset into new schema
    const outputSchema = {
      title: "TransformedProductRecord",
      description: "One record represents a transformed product with renamed fields and a computed tax-inclusive price.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: { type: "string", description: "Product code" },
          name: { type: "string", description: "Product description" },
          priceUsd: { type: "number", description: "Original unit price (USD)" },
          priceWithTaxUsd: { type: "number", description: "Unit price with 10% tax (USD)" },
        },
        required: ["sku", "name", "priceUsd", "priceWithTaxUsd"],
      },
      generatedAt: new Date().toISOString(),
    }

    const { datasetId: transformedDatasetId } = await createTransformDatasetStory<typeof env>({
      sourceDatasetIds: [sourceDatasetId],
      outputSchema,
      instructions: [
        "Transform the source dataset deterministically:",
        "- Input is JSONL lines: {\"type\":\"row\",\"data\":{...}}",
        "- Output must match OutputSchema exactly.",
        "- Map code -> sku, description -> name, price -> priceUsd.",
        "- Compute priceWithTaxUsd = round(priceUsd * 1.1, 2).",
        "- Preserve input row order.",
        "- Write output.jsonl to the provided OutputPath.",
      ].join("\n"),
    }).transform(env)

    const jsonlText = await getOutputJsonlText(adminDb, transformedDatasetId)
    const rows = parseJsonl(jsonlText)
      .filter((r) => r?.type === "row")
      .map((r) => r.data)

    expect(rows).toEqual([
      { sku: "A1", name: "Widget", priceUsd: 10.5, priceWithTaxUsd: 11.55 },
      { sku: "A2", name: "Gadget", priceUsd: 20, priceWithTaxUsd: 22 },
      { sku: "A3", name: "Thing", priceUsd: 30.25, priceWithTaxUsd: 33.28 },
    ])
  }, 240000)
})

