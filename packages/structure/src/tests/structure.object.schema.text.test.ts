import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { configureStructureTestRuntime } from "./_runtime.js"
import { structure } from "../structure.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await configureStructureTestRuntime()

describe("structure() (object + schema) text input", () => {
  it("persists an object result in context.content.outputs.object.value", async () => {
    const env = { orgId: "test-org" }

    const objectSchema = {
      title: "FileSummary",
      description: "Simple summary object",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          recordCount: { type: "number", description: "Number of records" },
          currency: { type: "string", description: "Currency code" },
        },
        required: ["recordCount", "currency"],
      },
    }

    const text = [
      "records=3",
      "currency=USD",
    ].join("\n")

    const res = await structure(env)
      .from({ kind: "text", text, mimeType: "text/plain", name: "meta.txt" })
      .instructions(
        [
          "Return EXACTLY this JSON object and nothing else:",
          "{\"recordCount\":3,\"currency\":\"USD\"}",
        ].join("\n"),
      )
      .schema(objectSchema)
      .asObject()
      .build()

    expect(res.datasetId).toBeTruthy()
    const content = (res.dataset?.content ?? {}) as any
    expect(content?.structure?.outputs?.object?.value).toEqual({ recordCount: 3, currency: "USD" })
  }, 240000)
})

