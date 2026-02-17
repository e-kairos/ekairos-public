import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { configureStructureTestRuntime } from "./_runtime.js"
import { structure } from "../structure.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const { db } = await configureStructureTestRuntime()

function extractToolParts(events: any[]) {
  const parts: any[] = []
  for (const e of events) {
    const ps = e?.content?.parts
    if (!Array.isArray(ps)) continue
    for (const p of ps) {
      if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
        parts.push(p)
      }
    }
  }
  return parts
}

describe("structure() trace (events + toolcalls)", () => {
  it("persists thread_items with tool parts and output states", async () => {
    const env = { orgId: "test-org" }

    const objectSchema = {
      title: "TraceObj",
      description: "Trace object",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
    }

    const res = await structure(env)
      .from({ kind: "text", text: "ok=true", mimeType: "text/plain", name: "trace.txt" })
      .instructions("Return only {\"ok\":true} and call complete.")
      .schema(objectSchema)
      .asObject()
      .build()

    const contextKey = `structure:${res.datasetId}`
    const q: any = await (db as any).query({
      thread_items: {
        $: {
          where: { "context.key": contextKey } as any,
          limit: 30,
          order: { createdAt: "asc" },
        },
      },
    })

    const events = q.thread_items ?? []
    expect(events.length).toBeGreaterThan(0)

    const toolParts = extractToolParts(events)
    expect(toolParts.length).toBeGreaterThan(0)

    // At least one tool part should have a settled state (output-available or output-error)
    const settled = toolParts.some((p) => p?.state === "output-available" || p?.state === "output-error")
    expect(settled).toBe(true)
  }, 240000)
})


