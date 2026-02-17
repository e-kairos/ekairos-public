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

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await configureStructureTestRuntime()

describe("structure() mixed sources (dataset -> object) + schema", () => {
  it("can consume a dataset source and produce an object output", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await fs.readFile(csvPath)

    const appDomain = domain("structure-tests-mixed-client")
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

    // 1) Produce rows dataset from file
    const rowsSchema = {
      title: "ProductRecord",
      description: "One row per product record.",
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
    }

    const rowsRes = await structure(env)
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
      .schema(rowsSchema)
      .asRows()
      .build()

    expect(rowsRes.datasetId).toBeTruthy()

    // 2) Consume that dataset as a source and produce an object summary
    const summarySchema = {
      title: "DatasetSummary",
      description: "Summary of the dataset.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          recordCount: { type: "number" },
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
        },
        required: ["recordCount", "minPrice", "maxPrice"],
      },
    }

    const objRes = await structure(env)
      .from({ kind: "dataset", datasetId: rowsRes.datasetId })
      .instructions(
        [
          "Read the dataset source (JSONL rows).",
          "CRITICAL: Compute recordCount, minPrice, maxPrice over the row 'price' field by reading the dataset source file in the sandbox (do not guess, do not invent).",
          "CRITICAL: Use executeCommand to compute these values deterministically.",
          "Example Python (adapt paths from Sources):",
          "import json",
          "prices = []",
          "count = 0",
          "with open(SOURCE_PATH, 'r', encoding='utf-8') as f:",
          "  for line in f:",
          "    line = line.strip()",
          "    if not line: continue",
          "    rec = json.loads(line)",
          "    if rec.get('type') != 'row': continue",
          "    data = rec.get('data') or {}",
          "    p = data.get('price')",
          "    if isinstance(p, (int, float)):",
          "      prices.append(float(p))",
          "    count += 1",
          "result = {",
          "  'recordCount': count,",
          "  'minPrice': min(prices) if prices else 0,",
          "  'maxPrice': max(prices) if prices else 0,",
          "}",
          "Return ONLY the final JSON object. Then call complete.",
        ].join("\n"),
      )
      .schema(summarySchema)
      .asObject()
      .build()

    const content = (objRes.dataset?.content ?? {}) as any
    expect(content?.structure?.outputs?.object?.value).toEqual({ recordCount: 3, minPrice: 10.5, maxPrice: 30.25 })
  }, 360000)
})

