import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { createMaterializeDatasetTool } from "../materializeDataset.tool"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const sourceDomain = domain("dataset-tool-source").schema({
  entities: {
    source_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-tool-app")
  .includes(datasetDomain)
  .includes(sourceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const datasetOnlyDomain = domain("dataset-tool-dataset-only")
  .includes(datasetDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const sourceOnlyDomain = domain("dataset-tool-source-only")
  .includes(sourceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class DatasetOnlyRuntime extends EkairosRuntime<Env, typeof datasetOnlyDomain, any> {
  protected getDomain() {
    return datasetOnlyDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class SourceOnlyRuntime extends EkairosRuntime<Env, typeof sourceOnlyDomain, any> {
  protected getDomain() {
    return sourceOnlyDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })
const datasetOnlyRuntime = new DatasetOnlyRuntime({ orgId: "org_1" })
const sourceOnlyRuntime = new SourceOnlyRuntime({ orgId: "org_1" })

// given: the tool runtime can persist datasets and query the configured source
// domain.
// when: createMaterializeDatasetTool receives that runtime and source domain.
// then: TypeScript accepts the tool configuration.
createMaterializeDatasetTool({
  runtime,
  queryDomain: sourceDomain,
})

// given: the runtime can persist datasets but cannot access the query source
// domain.
// when: the tool is configured with sourceDomain.
// then: TypeScript rejects the runtime before dynamic tool execution.
createMaterializeDatasetTool({
  runtime: datasetOnlyRuntime,
  // @ts-expect-error runtime must include queryDomain
  queryDomain: sourceDomain,
})

// given: the runtime can query sourceDomain but cannot persist dataset metadata.
// when: the tool is configured as a dataset materializer.
// then: TypeScript rejects the runtime because datasetDomain is missing.
createMaterializeDatasetTool({
  // @ts-expect-error runtime must include datasetDomain
  runtime: sourceOnlyRuntime,
  queryDomain: sourceDomain,
})
