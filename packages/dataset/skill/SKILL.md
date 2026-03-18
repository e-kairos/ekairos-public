---
name: dataset
description: Materialize, transform, and persist datasets using the Ekairos runtime manifest and InstantDB HTTP API.
---

# dataset

Use this skill when a task requires turning queries, local files, or existing datasets into a persisted dataset result.

The skill assumes:
- the current environment provides `EKAIROS_RUNTIME_MANIFEST_PATH`, or the manifest is at `.ekairos/runtime.json`
- the runtime manifest contains `appId`, domain context, and optionally a scoped token
- when no token is present in the manifest, network/header injection will provide `as-token`

## What this skill provides

- `code/query_to_jsonl.mjs`
  - Runs an Instant query and writes normalized dataset rows to a local JSONL file.
- `code/dataset_source_to_jsonl.mjs`
  - Downloads an existing dataset output file to a local JSONL file.
- `code/complete_dataset.mjs`
  - Uploads a local JSONL output file to Instant storage and upserts the target dataset metadata.

## Usage pattern

1. Create a small JSON input file for the command you want to run.
2. Run the appropriate `node code/*.mjs <input.json>` command.
3. For transformations:
   - prepare one or more source JSONL files,
   - use your own shell/python/node transform to create the final output JSONL,
   - run `complete_dataset.mjs` to persist the dataset.

## Input formats

### `query_to_jsonl.mjs`

```json
{
  "query": { "items": {} },
  "outputPath": "./work/source.jsonl",
  "manifestPath": "./.ekairos/runtime.json"
}
```

### `dataset_source_to_jsonl.mjs`

```json
{
  "datasetId": "source_dataset_v1",
  "outputPath": "./work/source_dataset.jsonl",
  "manifestPath": "./.ekairos/runtime.json"
}
```

### `complete_dataset.mjs`

```json
{
  "datasetId": "target_dataset_v1",
  "outputPath": "./work/output.jsonl",
  "title": "Target Dataset",
  "organizationId": "org_123",
  "sandboxId": "sandbox_123",
  "sources": [{ "kind": "query" }],
  "sourceKinds": ["query"],
  "instructions": "Summarize the query",
  "schema": { "title": "Row", "description": "One row", "schema": { "type": "object" } },
  "analysis": { "mode": "summary" }
}
```

## Notes

- Local workspace files can be read directly; no special fetch script is required for them.
- Query normalization follows the dataset builder convention:
  - a single top-level array becomes rows,
  - a single top-level object becomes one row,
  - multi-entity results become rows with `__entity`.
- `complete_dataset.mjs` expects the final output file to be JSONL with rows shaped like:

```json
{"type":"row","data":{...}}
```
