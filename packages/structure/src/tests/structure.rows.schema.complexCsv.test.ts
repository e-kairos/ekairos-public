import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox/schema"
import { structureDomain } from "../schema.js"
import { configureStructureTestRuntime } from "./_runtime.js"
import { structure } from "../structure.js"
import { DatasetService } from "../service.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await configureStructureTestRuntime()

describe("structure() (rows + schema) complex_products.csv", () => {
  it("parses quoted CSV, normalizes price, and preserves order", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "complex_products.csv")
    const csvBuffer = await fs.readFile(csvPath)

    const appDomain = domain("structure-tests-complex-csv-client")
      .includes(structureDomain)
      .includes(sandboxDomain)
      .schema({ entities: {}, links: {}, rooms: {} })

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: appDomain.toInstantSchema(),
    } as any)

    const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-complex.csv`
    const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "complex_products.csv",
    })
    const fileId = uploadResult?.data?.id as string
    expect(fileId).toBeTruthy()

    const env = { orgId: "test-org" }

    const outputSchema = {
      title: "ProductRecord",
      description: "One row per product record.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          description: { type: "string" },
          price: { type: "number" },
          categoryId: { type: "string" },
        },
        required: ["code", "description", "price", "categoryId"],
      },
    }

    const res = await structure(env)
      .from({ kind: "file", fileId })
      .instructions(
        [
          "Transform the file deterministically:",
          "- Input is a CSV with headers code,description,price,categoryId,notes.",
          "- Output must match OutputSchema exactly.",
          "- Preserve row order.",
          "- Price normalization: strip '$' and commas, trim whitespace, parse as number.",
          "- Ignore the input column 'notes'.",
          "- Write output.jsonl to OutputPath.",
          "",
          "CRITICAL: Use executeCommand with Python and the csv module.",
        ].join("\n"),
      )
      .schema(outputSchema)
      .asRows()
      .build()

    const datasetId = res.datasetId
    expect(datasetId).toBeTruthy()

    const ds = new DatasetService(adminDb as any)
    const gen = await ds.readRecordsFromFile(datasetId)
    expect(gen.ok).toBe(true)

    const rows: any[] = []
    for await (const rec of gen.ok ? gen.data : []) rows.push(rec)

    const dataRows = rows.filter((r) => r?.type === "row").map((r) => r.data)
    expect(dataRows).toEqual([
      { code: "P-001", description: "Widget, Deluxe", price: 1200.5, categoryId: "C-1" },
      { code: "P-002", description: 'Gadget "Pro"', price: 20, categoryId: "C-2" },
      { code: "P-003", description: "Thing", price: 30.25, categoryId: "C-1" },
    ])
  }, 360000)
})

