import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { id, init, lookup } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox/schema"
import { structureDomain } from "../schema.js"
import { configureStructureTestRuntime } from "./_runtime.js"
import { structure } from "../structure.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await configureStructureTestRuntime()

async function uploadCsv(adminDb: any, name: string) {
  const csvPath = path.resolve(__dirname, "fixtures", name)
  const csvBuffer = await fs.readFile(csvPath)
  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`
  const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
    contentType: "text/csv",
    contentDisposition: name,
  })
  return uploadResult?.data?.id as string
}

async function createRowsDatasetContext(params: {
  adminDb: any
  datasetId: string
  rows: any[]
  name: string
}) {
  const { adminDb, datasetId, rows, name } = params
  const contextKey = `structure:${datasetId}`

  const jsonl = rows.map((r) => JSON.stringify({ type: "row", data: r })).join("\n") + "\n"
  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}.jsonl`
  const uploadResult = await adminDb.storage.uploadFile(storagePath, Buffer.from(jsonl, "utf-8"), {
    contentType: "application/x-ndjson",
    contentDisposition: `${name}.jsonl`,
  })
  const fileId = uploadResult?.data?.id as string
  if (!fileId) throw new Error("Failed to upload dataset jsonl")

  // Create the context record and link the output file (so Structure can consume it as a dataset source).
  await adminDb.transact(
    adminDb.tx.thread_contexts[id()].create({
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "structure",
      key: contextKey,
      status: "open",
      content: {
        structure: {
          kind: "ekairos.structure",
          version: 1,
          structureId: datasetId,
          state: "completed",
          outputs: {
            rows: { format: "jsonl", fileId },
          },
        },
      },
    }),
  )

  await adminDb.transact(adminDb.tx.thread_contexts[lookup("key", contextKey)].link({ structure_output_file: fileId }))

  return { datasetId, fileId }
}

describe("structure() combined datasets (products + categories) -> object summary (schema)", () => {
  it("joins datasets deterministically in python and returns a stable summary object", async () => {
    const appDomain = domain("structure-tests-join-object-client")
      .includes(structureDomain)
      .includes(sandboxDomain)
      .schema({ entities: {}, links: {}, rooms: {} })

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: appDomain.toInstantSchema(),
    } as any)

    const env = { orgId: "test-org" }

    // Pre-create two dataset contexts deterministically (so this test focuses on consuming datasets + joining them).
    // These rows match the fixtures:
    // - complex_products.csv (normalized prices)
    // - categories.csv
    const productsDatasetId = id()
    const categoriesDatasetId = id()

    const productsRows = [
      { code: "P-001", description: "Widget, Deluxe", price: 1200.5, categoryId: "C-1" },
      { code: "P-002", description: 'Gadget "Pro"', price: 20, categoryId: "C-2" },
      { code: "P-003", description: "Thing", price: 30.25, categoryId: "C-1" },
    ]
    const categoriesRows = [
      { categoryId: "C-1", categoryName: "Hardware" },
      { categoryId: "C-2", categoryName: "Software" },
    ]

    await createRowsDatasetContext({ adminDb, datasetId: productsDatasetId, rows: productsRows, name: "products" })
    await createRowsDatasetContext({ adminDb, datasetId: categoriesDatasetId, rows: categoriesRows, name: "categories" })

    const summarySchema = {
      title: "JoinSummary",
      description: "Deterministic summary over joined datasets.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          totalProducts: { type: "number" },
          categories: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                categoryName: { type: "string" },
                count: { type: "number" },
                avgPrice: { type: "number" },
              },
              required: ["categoryName", "count", "avgPrice"],
            },
            // Enforce that BOTH category groups are present (prevents empty join results).
            allOf: [
              { contains: { type: "object", properties: { categoryName: { const: "Hardware" } }, required: ["categoryName"] } },
              { contains: { type: "object", properties: { categoryName: { const: "Software" } }, required: ["categoryName"] } },
            ],
          },
        },
        required: ["totalProducts", "categories"],
      },
    }

    const summary = await structure(env)
      .from({ kind: "dataset", datasetId: productsDatasetId }, { kind: "dataset", datasetId: categoriesDatasetId })
      .instructions(
        [
          "You have two dataset Sources:",
          "- products dataset (rows) with fields: code, description, price, categoryId",
          "- categories dataset (rows) with fields: categoryId, categoryName",
          "",
          "CRITICAL: Use executeCommand (python) ONCE to read BOTH JSONL source files from Sources paths.",
          "Process (no guessing):",
          "- Identify which Source is products and which is categories (by inspecting their row fields).",
          "- Read JSONL line-by-line; only keep records where type == 'row' and use record.data as the row object.",
          "- Build a map categoryId -> categoryName from the categories dataset.",
          "- Aggregate products by categoryName (join on categoryId): count and average price.",
          "- Set totalProducts to the total number of product rows.",
          "- Output categories sorted by categoryName ascending.",
          "CRITICAL: Immediately after computing the object, call complete with resultJson (inline JSON). Do not do anything else.",
        ].join("\n"),
      )
      .schema(summarySchema)
      .asObject()
      .build()

    const value = (summary.dataset?.content as any)?.structure?.outputs?.object?.value
    expect(value).toEqual({
      totalProducts: 3,
      categories: [
        { categoryName: "Hardware", count: 2, avgPrice: 615.375 },
        { categoryName: "Software", count: 1, avgPrice: 20 },
      ],
    })
  }, 480000)
})


