import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const appDomain = domain("dataset-structure-output-api")
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
const builder = dataset(runtime, { datasetId: "structure_like_dataset" })
builder.datasetId

const objectSchema = {
  title: "Summary",
  description: "Single object output",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recordCount: { type: "number" },
    },
    required: ["recordCount"],
  },
}

async function outputModes() {
  // given: structure callers pass datasetId when constructing the builder.
  // when: dataset is used as the replacement API.
  // then: datasetId is exposed on the builder and build() can be called without
  // repeating it at the end of the chain.
  await builder
    .from({ kind: "text", text: "records=3" })
    .auto()
    .asRows()
    .build()

  // given: structure callers explicitly choose rows output.
  // when: the same chain is expressed with dataset.
  // then: asRows is accepted as the explicit default output mode.
  await dataset(runtime)
    .from({ kind: "text", text: "records=3" })
    .schema(objectSchema)
    .asRows()
    .build({ datasetId: "rows_dataset" })

  // given: structure callers can ask for auto schema inference.
  // when: dataset is used as the replacement.
  // then: auto is accepted as an alias for inferSchema.
  await dataset(runtime)
    .from({ kind: "text", text: "records=3" })
    .auto()
    .asRows()
    .build({ datasetId: "auto_dataset" })

  // given: structure object output returned an object-oriented result.
  // when: dataset uses asObject.
  // then: the output is represented as a single-row dataset and exposed as
  // object/firstRow in the typed build result.
  const result = await dataset(runtime)
    .from({ kind: "text", text: "records=3" })
    .schema(objectSchema)
    .asObject()
    .build({ datasetId: "object_dataset" })

  result.object?.recordCount
  result.firstRow?.recordCount
}

void outputModes
