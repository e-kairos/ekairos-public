# Dataset Runtime

Internal implementation notes for the dataset package.

## Core idea

`@ekairos/dataset` turns query, file, text, and dataset sources into persisted datasets.

It uses:

- InstantDB for canonical dataset records and files
- `@ekairos/events` for iterative agent loops
- `@ekairos/sandbox` for command execution and file processing

## Runtime contract

Dataset is runtime-first. Callers pass an `EkairosRuntime` whose root domain includes `datasetDomain`.

```ts
await dataset(runtime, { datasetId: "products_v1" })
  .from({ kind: "text", text: "sku,price\nA1,10", mimeType: "text/csv" })
  .auto()
  .asRows()
  .build()
```

Query sources need a second domain: the source domain being queried. The runtime must include both `datasetDomain` and the source domain. Compatibility is checked by domain name and schema, including transitive subdomains.

```ts
await dataset(runtime)
  .fromQuery(sourceDomain, {
    query: {
      source_items: {},
    },
  })
  .build({ datasetId: "source_snapshot_v1" })
```

## Structure replacement

The replacement API keeps the structure-style source and output shape:

- `from({ kind: "file" | "text" | "dataset", ... })`
- `auto()` / `schema(...)`
- `asRows()` / `asObject()`
- `dataset(runtime, { datasetId })` with `build()` at the end of the chain

`asObject()` is represented as a single-row dataset. The build result exposes both `firstRow` and `object`, while persistence stays inside the dataset domain.

## High-level flow

1. Create or update dataset metadata.
2. Materialize source data.
3. Run sandbox-backed transforms when needed.
4. Validate rows against schema.
5. Upload JSONL output to InstantDB storage.
6. Mark the dataset as completed.

## Important rule

Reads and metadata live in InstantDB.
Heavy file or transform work lives in sandbox commands.
