import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { structure } from "../structure.js"
import { configureStructureTestRuntime } from "./_runtime.js"
import { DatasetService } from "../service.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const { db } = await configureStructureTestRuntime()

describe("structure() (rows + auto) text input", () => {
  it("infers schema and persists output.jsonl via context link", async () => {
    const env = { orgId: "test-org" }

    const text = ["code,description,price", "A1,Widget,10.5", "A2,Gadget,20"].join("\n")

    const res = await structure(env)
      .from({ kind: "text", text, mimeType: "text/csv", name: "sample.csv" })
      .instructions(
        [
          "Infer an output schema and then produce rows output.",
          "Output rows must be objects with fields code, description, price.",
          "CRITICAL: Write output.jsonl to OutputPath.",
          "CRITICAL: Call generateSchema first, then call complete.",
        ].join("\n"),
      )
      .auto()
      .asRows()
      .build()

    expect(res.datasetId).toBeTruthy()

    // Validate output via the back-compat reader (context -> structure_output_file -> url -> jsonl)
    const ds = new DatasetService(db as any)
    const gen = await ds.readRecordsFromFile(res.datasetId)
    expect(gen.ok).toBe(true)

    const rows: any[] = []
    for await (const rec of gen.ok ? gen.data : []) {
      rows.push(rec)
    }

    const dataRows = rows
      .map((r) => {
        if (r?.type === "row" && r?.data) return r.data
        if (r && typeof r === "object" && "code" in r && "description" in r && "price" in r) return r
        return null
      })
      .filter(Boolean)
    expect(dataRows.length).toBeGreaterThanOrEqual(1)
    for (const row of dataRows) {
      expect(typeof row?.code).toBe("string")
      expect(typeof row?.description).toBe("string")
      expect(typeof row?.price).toBe("number")
    }
  }, 600000)
})

