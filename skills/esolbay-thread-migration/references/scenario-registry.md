# Scenario Registry

This file is generated from migration run reports.

| Scenario | Count | Step | Recommended Action |
| --- | ---: | --- | --- |
| `verify_non_indexed_order` | 4 | `verify` | Remove order clause for non-indexed attrs in verification query or index the attribute explicitly. |

## verify_non_indexed_order

- Count: 4
- Step: `verify`
- Signature: `verify|verify_non_indexed_order|admin/query failed (400): {"type":"validation-failed","message":"Validation failed for query: The `thread_threads.createdAt` attribute is no`
- Source: `migration_artifacts.warning`
- Run IDs: `org38-temp-domain-platformapi-20260211-1`, `org39-temp-domain-final6`, `org39-temp-domain-platformapi-20260211-1`, `org39-temp-domain-platformapi-20260211-2`
- Action: Remove order clause for non-indexed attrs in verification query or index the attribute explicitly.
- Samples:
  - `admin/query failed (400): {"type":"validation-failed","message":"Validation failed for query: The `thread_threads.createdAt` attribute is not indexed. Only indexed and typed attributes can be used to order by.","hint":{"`
  - `admin/query failed (400): {"type":"validation-failed","message":"Validation failed for query: The `thread_threads.createdAt` attribute is not indexed. Only indexed and typed attributes can be used to order by.","hint":{"`
  - `admin/query failed (400): {"type":"validation-failed","message":"Validation failed for query: The `thread_threads.createdAt` attribute is not indexed. Only indexed and typed attributes can be used to order by.","hint":{"`

