import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const appDomain = domain("dataset-structure-source-api")
  .includes(datasetDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })

// given: structure callers pass explicit kind-tagged file, text, and dataset
// sources to `.from(...)`.
// when: the same source shape is used with dataset.
// then: dataset accepts the structure-compatible source shape without requiring
// callers to switch to fromFile/fromText/fromDataset.
dataset(runtime).from(
  { kind: "file", fileId: "file_1", description: "uploaded csv" },
  { kind: "text", text: "code,price\nA1,10", mimeType: "text/csv", name: "inline.csv" },
  { kind: "dataset", datasetId: "dataset_1", description: "existing dataset" },
)

// given: dataset also keeps the more ergonomic source-specific methods.
// when: callers omit the explicit source kind in `.from(...)`.
// then: the builder still accepts file, text, and existing dataset sources.
dataset(runtime).from(
  { fileId: "file_1" },
  { text: "plain text", name: "input.txt" },
  { datasetId: "dataset_1" },
)

// given: query sources require a second domain and runtime compatibility check.
// when: callers try to sneak a query source through structure-style `.from(...)`.
// then: the public source union rejects it so query materialization must go
// through `.fromQuery(sourceDomain, ...)`.
dataset(runtime).from(
  // @ts-expect-error query sources must use fromQuery(sourceDomain, source)
  { kind: "query", query: { any_entity: {} } },
)
