import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { structure } from "../structure.js"
import { configureStructureTestRuntime } from "./_runtime.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await configureStructureTestRuntime()

describe("structure() (object + auto) text input", () => {
  it("infers schema and persists object result in context.content", async () => {
    const env = { orgId: "test-org" }

    const text = ["records=3", "currency=USD"].join("\n")

    const res = await structure(env)
      .from({ kind: "text", text, mimeType: "text/plain", name: "meta.txt" })
      .instructions(
        [
          "Infer an output schema and then produce the final object result.",
          "Return EXACTLY this JSON object:",
          "{\"recordCount\":3,\"currency\":\"USD\"}",
          "CRITICAL: Call generateSchema first, then call complete.",
        ].join("\n"),
      )
      .auto()
      .asObject()
      .build()

    expect(res.datasetId).toBeTruthy()
    const content = (res.dataset?.content ?? {}) as any
    expect(content?.structure?.outputSchema?.schema).toBeTruthy()
    expect(content?.structure?.outputs?.object?.value).toEqual({ recordCount: 3, currency: "USD" })
  }, 600000)
})

