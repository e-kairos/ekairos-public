import { it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "path"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { threadDomain } from "@ekairos/thread"
import { configureRuntime } from "@ekairos/domain/runtime"
import { registerThreadEnv } from "@ekairos/thread/runtime"
import { datasetDomain } from "../schema"
import { queryDomain } from "../query/queryDomain"
import { describeInstant, setupInstantTestEnv } from "./_env"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await setupInstantTestEnv("dataset-query-domain");

describeInstant("queryDomain (sample)", () => {
  it("creates a dataset from a domain query and returns preview rows", async () => {
    const sampleDomain = domain("sample").schema({
      entities: {
        sample_items: i.entity({
          name: i.string(),
          price: i.number(),
          category: i.string(),
        }),
      },
      links: {},
      rooms: {},
    })

    const appDomain = domain("dataset-tests")
      .includes(datasetDomain)
      .includes(sampleDomain)
      .includes(threadDomain)
      .schema({ entities: {}, links: {}, rooms: {} })

    const db = init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: appDomain.toInstantSchema(),
    } as any)

    configureRuntime({
      runtime: async () => ({ db } as any),
    })
    registerThreadEnv({ orgId: "test-org" })

    const item1 = newId()
    const item2 = newId()
    const item3 = newId()

    await db.transact([
      db.tx.sample_items[item1].update({
        name: "Widget",
        price: 10,
        category: "Electronics",
      }),
      db.tx.sample_items[item2].update({
        name: "Gadget",
        price: 20,
        category: "Electronics",
      }),
      db.tx.sample_items[item3].update({
        name: "Paper",
        price: 2,
        category: "Office",
      }),
    ])

    const explanation = `Sea A = Dominio("sample"). D1 = \\pi_{name,price}(\\sigma_{category="Electronics"}(A.sample_items)).`

    const result = await queryDomain({
      query: {
        sample_items: {
          $: {
            where: { category: "Electronics" },
            fields: ["name", "price", "category"],
            limit: 10,
          },
        },
      },
      explanation,
      title: "electronics-items",
    })

    expect(result.datasetId).toBeTruthy()
    expect(result.previewRows.length).toBeGreaterThan(0)
    expect(result.rowCount).toBe(2)
    expect(result.explanation).toContain("Dominio")

    const datasetQuery: any = await db.query({
      dataset_datasets: { $: { where: { id: result.datasetId }, limit: 1 } },
      dataset_records: { $: { where: { "dataset.id": result.datasetId }, limit: 10 } },
    })

    const dataset = datasetQuery.dataset_datasets?.[0]
    expect(dataset).toBeTruthy()
    expect(dataset.status).toBe("completed")

    const records = datasetQuery.dataset_records ?? []
    expect(records.length).toBe(2)
  }, 60000)
})
