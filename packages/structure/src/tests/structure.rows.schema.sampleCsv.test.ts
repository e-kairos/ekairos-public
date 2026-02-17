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

function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

describe("structure() (rows + schema) sample.csv", () => {
  it("produces rows output.jsonl and validates against provided schema", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await fs.readFile(csvPath)

    const appDomain = domain("structure-tests-client")
      .includes(structureDomain)
      .includes(sandboxDomain)
      .schema({ entities: {}, links: {}, rooms: {} })

    const adminDb = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: appDomain.toInstantSchema(),
    } as any)

    const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}.csv`
    const uploadResult = await adminDb.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
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
          code: { type: "string", description: "Product code" },
          description: { type: "string", description: "Product description" },
          price: { type: "number", description: "Unit price" },
        },
        required: ["code", "description", "price"],
      },
    }

    const res = await structure(env)
      .from({ kind: "file", fileId })
      .instructions(
        [
          "Transform the file deterministically:",
          "- Input is a CSV with headers code,description,price.",
          "- Output must match OutputSchema exactly.",
          "- Preserve row order.",
          "- Write output.jsonl to OutputPath.",
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
    for await (const rec of gen.ok ? gen.data : []) {
      rows.push(rec)
    }

    const dataRows = rows.filter((r) => r?.type === "row").map((r) => r.data)
    expect(dataRows).toEqual([
      { code: "A1", description: "Widget", price: 10.5 },
      { code: "A2", description: "Gadget", price: 20 },
      { code: "A3", description: "Thing", price: 30.25 },
    ])
  }, 240000)
})

