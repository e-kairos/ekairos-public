# @ekairos/dataset

Runtime-first dataset materialization for Ekairos domains.

`@ekairos/dataset` replaces the older `@ekairos/structure` flow with a domain-owned dataset API. It persists dataset metadata and output rows in InstantDB, while file parsing and transformations run through sandbox-backed reactors when work cannot be materialized directly.

## Mental Model

A dataset build has two responsibilities:

1. Read or produce source rows from one or more sources.
2. Persist the resulting dataset under `datasetDomain`.

The caller passes a typed `EkairosRuntime`. The runtime must include `datasetDomain`; query sources also require the runtime to include the queried source domain.

```ts
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { dataset, datasetDomain } from "@ekairos/dataset"

import { sourceDomain } from "./source.domain"

const appDomain = domain("app")
  .includes(datasetDomain)
  .includes(sourceDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })

class AppRuntime extends EkairosRuntime<{ orgId: string }, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return db
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })
```

Use `appDomain.toInstantSchema()` to provision or push the InstantDB schema. Dataset itself does not own global DB access; it uses `runtime.use(datasetDomain)` internally.

## Basic Usage

```ts
const result = await dataset(runtime, { datasetId: "products_v1" })
  .from({ kind: "text", text: "sku,price\nA1,10", mimeType: "text/csv" })
  .auto()
  .asRows()
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build()

console.log(result.datasetId)
console.log(result.previewRows)
```

`dataset(runtime, { datasetId })` mirrors the old `structure(env, { datasetId })` style. You can also pass the id at build time:

```ts
await dataset(runtime)
  .from({ kind: "dataset", datasetId: "source_dataset_v1" })
  .schema(productSchema)
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build({ datasetId: "normalized_products_v1" })
```

## Sources

Use `.from(...)` for structure-compatible sources:

```ts
dataset(runtime).from(
  { kind: "file", fileId: "file_1", description: "Supplier CSV" },
  { kind: "text", text: "sku,price\nA1,10", mimeType: "text/csv", name: "inline.csv" },
  { kind: "dataset", datasetId: "existing_dataset_v1" },
)
```

The builder also keeps explicit source methods:

```ts
dataset(runtime)
  .fromFile({ fileId: "file_1" })
  .fromText({ text: "raw input", name: "input.txt" })
  .fromDataset({ datasetId: "existing_dataset_v1" })
```

Query sources must use `.fromQuery(sourceDomain, ...)` because they need a second domain:

```ts
const snapshot = await dataset(runtime, { datasetId: "open_items_v1" })
  .fromQuery(sourceDomain, {
    query: {
      source_items: {
        $: {
          where: { status: "open" },
          fields: ["title", "quantity"],
          limit: 100,
        },
      },
    },
    title: "Open items",
    explanation: "Snapshot of open source items",
  })
  .build()
```

The query is typed with the same InstantDB query types used by `db.query`. Unknown entities, fields, filters, and link shapes fail at compile time.

## Runtime Compatibility

The runtime check is name plus schema, not name only.

```ts
const appDomain = domain("app")
  .includes(datasetDomain)
  .includes(sourceDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })

dataset(runtime).fromQuery(sourceDomain, { query: { source_items: {} } })
```

Subdomains are supported transitively. If domain `B` includes domain `A`, and the runtime root includes `B`, then `.fromQuery(A, ...)` is accepted.

A different domain with the same name but incompatible schema is rejected. A runtime that includes only `datasetDomain` can persist datasets but cannot query a source domain through `.fromQuery(...)`.

## Output Modes

Rows are the default output:

```ts
await dataset(runtime)
  .from({ kind: "dataset", datasetId: "source_v1" })
  .asRows()
  .build({ datasetId: "rows_v1" })
```

Object output is represented as a single-row dataset:

```ts
const result = await dataset(runtime, { datasetId: "summary_v1" })
  .from({ kind: "dataset", datasetId: "orders_v1" })
  .instructions("Summarize orders by currency.")
  .schema(summarySchema)
  .asObject()
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build()

console.log(result.object)
```

`asObject()` forces a one-row output contract. The persisted dataset still uses JSONL rows, and the returned result exposes the row as both `firstRow` and `object`.

## Schema Modes

Use `schema(...)` when the output contract is known:

```ts
const productSchema = {
  title: "ProductRow",
  description: "One product row",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sku: { type: "string" },
      price: { type: "number" },
    },
    required: ["sku", "price"],
  },
}

await dataset(runtime)
  .from({ kind: "file", fileId })
  .schema(productSchema)
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build({ datasetId: "products_v1" })
```

Use `auto()` or `inferSchema()` when the builder should infer a schema from the materialized rows:

```ts
await dataset(runtime)
  .from({ kind: "text", text: csv, mimeType: "text/csv" })
  .auto()
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build({ datasetId: "auto_products_v1" })
```

`auto()` is an alias for `inferSchema()`.

## Sandbox And Reactor Requirements

Some builds can materialize directly:

- A single query source without custom instructions can run without sandbox or reactor.

Other builds require sandbox execution and a reactor:

- File sources
- Text sources
- Existing dataset transformations
- Multiple sources
- Query sources with custom instructions
- Any build that needs agent-driven parsing or transformation

If these are missing, the builder throws `dataset_sandbox_required` or `dataset_reactor_required`.

## Build Result

```ts
type DatasetBuildResult = {
  datasetId: string
  dataset: any
  previewRows: any[]
  reader: {
    read(cursor?: number, limit?: number): Promise<{
      rows: any[]
      cursor: number
      done: boolean
    }>
    read(params?: { cursor?: number; limit?: number }): Promise<{
      rows: any[]
      cursor: number
      done: boolean
    }>
  }
  firstRow?: any | null
  object?: any | null
}
```

Read more rows with the returned reader:

```ts
const page = await result.reader.read({ cursor: 0, limit: 100 })
```

Use `.first()` when the build must produce zero or one row:

```ts
const result = await dataset(runtime)
  .fromQuery(sourceDomain, { query: { source_items: { $: { limit: 1 } } } })
  .first()
  .build({ datasetId: "single_item_v1" })

console.log(result.firstRow)
```

If more than one row is produced, the builder throws `dataset_first_expected_zero_or_one_row`.

## Declarative Tool

`createMaterializeDatasetTool` exposes the same materialization contract as an AI SDK tool. It is useful when a reactor or agent needs to request dataset builds declaratively.

```ts
import { createMaterializeDatasetTool } from "@ekairos/dataset"

const materializeDataset = createMaterializeDatasetTool({
  runtime,
  reactor,
  queryDomain: sourceDomain,
})
```

Tool input:

```ts
{
  datasetId?: string
  sandboxId?: string
  title?: string
  sources: Array<
    | { kind: "file"; fileId: string; description?: string }
    | { kind: "text"; text: string; mimeType?: string; name?: string; description?: string }
    | { kind: "dataset"; datasetId: string; description?: string }
    | { kind: "query"; query: Record<string, any>; title?: string; explanation?: string }
  >
  instructions?: string
  mode?: "auto" | "schema"
  output?: "rows" | "object"
  schema?: DatasetSchemaInput
  first?: boolean
}
```

The tool returns only `{ datasetId }`.

The tool runtime must include `datasetDomain`, and its `queryDomain` must also be compatible with that same runtime.

## Replacing Structure

Old structure-style chain:

```ts
await structure(env, { datasetId: "summary_v1" })
  .from({ kind: "text", text, mimeType: "text/plain", name: "input.txt" })
  .instructions("Return a summary object.")
  .schema(summarySchema)
  .asObject()
  .build()
```

Dataset replacement:

```ts
await dataset(runtime, { datasetId: "summary_v1" })
  .from({ kind: "text", text, mimeType: "text/plain", name: "input.txt" })
  .instructions("Return a summary object.")
  .schema(summarySchema)
  .asObject()
  .sandbox({ sandboxId })
  .reactor(reactor)
  .build()
```

Key differences:

- Pass `runtime`, not `env`.
- The runtime must include `datasetDomain`.
- Query sources must be explicit: `.fromQuery(sourceDomain, { query })`.
- Object output is stored as a one-row dataset, not as structure context content.
- Sandbox and reactor are explicit when parsing or transforming is required.

## Exports

Main exports:

- `dataset`
- `datasetDomain`
- `createMaterializeDatasetTool`
- `materializeDatasetToolInputSchema`
- `DatasetBuilder`
- `DatasetBuildResult`
- `DatasetSourceInput`
- `DatasetSchemaInput`
- `DatasetOutput`
- `DatasetMode`

## Internal Notes

Implementation notes live in `src/README.md`. Public callers should use the root package API from `@ekairos/dataset`.
