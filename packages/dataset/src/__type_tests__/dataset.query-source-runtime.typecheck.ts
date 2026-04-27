import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const sourceDomain = domain("dataset-source").schema({
  entities: {
    source_items: i.entity({
      title: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

const sourceContainerDomain = domain("dataset-source-container")
  .includes(sourceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const incompatibleSameNameSourceDomain = domain("dataset-source").schema({
  entities: {
    incompatible_items: i.entity({
      label: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-source-runtime-app")
  .includes(datasetDomain)
  .includes(sourceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const appWithTransitiveSourceDomain = domain("dataset-transitive-source-runtime-app")
  .includes(datasetDomain)
  .includes(sourceContainerDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const datasetOnlyDomain = domain("dataset-only-runtime-app")
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

class TransitiveAppRuntime extends EkairosRuntime<Env, typeof appWithTransitiveSourceDomain, any> {
  protected getDomain() {
    return appWithTransitiveSourceDomain
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

const runtime = new AppRuntime({ orgId: "org_1" })
const transitiveRuntime = new TransitiveAppRuntime({ orgId: "org_1" })
const datasetOnlyRuntime = new DatasetOnlyRuntime({ orgId: "org_1" })

// given: the runtime root includes both datasetDomain and the query source
// domain.
// when: callers materialize a dataset from a source-domain query.
// then: fromQuery accepts the source domain because runtime.use(sourceDomain)
// is valid for that same runtime.
dataset(runtime).fromQuery(sourceDomain, {
  query: {
    source_items: {},
  },
})

// given: sourceDomain is included through sourceContainerDomain rather than
// directly at the runtime root.
// when: callers pass the leaf sourceDomain to fromQuery.
// then: transitive included-domain names and schema keep the runtime compatible.
dataset(transitiveRuntime).fromQuery(sourceDomain, {
  query: {
    source_items: {},
  },
})

// given: datasetOnlyRuntime can persist dataset metadata but has no access to
// the requested source domain.
// when: callers try to query sourceDomain through that runtime.
// then: fromQuery rejects the source domain at compile time.
dataset(datasetOnlyRuntime).fromQuery(
  // @ts-expect-error runtime root domain must include the query source domain
  sourceDomain,
  {
    query: {
      source_items: {},
    },
  },
)

// given: a different domain reuses the same name as sourceDomain but exposes a
// different schema.
// when: callers pass that same-name domain to a runtime that only includes the
// original schema.
// then: compatibility still fails because the runtime check is name + schema,
// not name only.
dataset(runtime).fromQuery(
  // @ts-expect-error source domain name alone is insufficient when schema differs
  incompatibleSameNameSourceDomain,
  {
    query: {
      incompatible_items: {},
    },
  },
)
