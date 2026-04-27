import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const sourceDomain = domain("dataset-query-typing-source").schema({
  entities: {
    source_items: i.entity({
      title: i.string().indexed(),
      quantity: i.number().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-query-typing-app")
  .includes(datasetDomain)
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

const runtime = new AppRuntime({ orgId: "org_1" })

// given: sourceDomain exposes source_items with title and quantity fields.
// when: callers write an InstaQL query through dataset.fromQuery.
// then: the query parameter accepts the same entity and where-field shape that
// InstantDB accepts for db.query with this domain schema.
dataset(runtime).fromQuery(sourceDomain, {
  query: {
    source_items: {
      $: {
        where: {
          title: "Ready",
          quantity: { $gte: 1 },
        },
        order: {
          quantity: "desc",
        },
        limit: 10,
      },
    },
  },
})

// given: query validation is scoped to sourceDomain, not datasetDomain.
// when: callers query an entity that is not declared by sourceDomain.
// then: TypeScript rejects the query object before it can be passed to InstantDB.
dataset(runtime).fromQuery(sourceDomain, {
  // @ts-expect-error unknown_entities is not part of sourceDomain
  query: {
    unknown_entities: {},
  },
})

// given: source_items has title and quantity fields, but no missingField.
// when: callers filter source_items by an unknown field.
// then: the same ValidQuery constraint used by InstantDB rejects the where
// clause through the dataset builder.
dataset(runtime).fromQuery(sourceDomain, {
  query: {
    source_items: {
      $: {
        // @ts-expect-error missingField is not a source_items field
        where: {
          missingField: "value",
        },
      },
    },
  },
})
