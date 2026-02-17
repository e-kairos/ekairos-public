# Before/After Migration Contract

Use this file as the mandatory input for migration code generation.

## 1) Release scope

- from version:
- to version:
- feature scope: story deprecated -> thread package adoption

## 2) Before (current state)

- runtime entrypoints:
- domain/schema entities in use:
- story APIs currently used:
- data invariants currently guaranteed:

## 3) After (target state)

- runtime entrypoints:
- thread APIs adopted:
- schema/data model deltas:
- data invariants that must still hold:

## 4) Required transformations

For each entity affected:

- source selector/query:
- transform rule:
- target tx rule:
- idempotency key strategy:

Also reconcile each transformation with related `planSchemaPush` steps:

- plan step type:
- plan friendly description:
- mapping to transform/apply script:

### Mandatory story -> thread entity mapping

Use this mapping as baseline unless explicitly overridden by release notes:

| Legacy entity | Target entity | Required notes |
| --- | --- | --- |
| `context_contexts` | `thread_contexts` + `thread_threads` | preserve context id, preserve key/title/status, create deterministic thread id |
| `context_events` | `thread_items` | preserve ids and message ordering (`createdAt`) |
| `story_executions` | `thread_executions` | preserve workflow run metadata and status |
| `story_steps` | `thread_steps` | preserve iteration + event linkage + tool metadata |
| `story_parts` | `thread_parts` | preserve normalized parts and per-step ordering (`idx`) |

### Mandatory link invariants

- Every migrated `thread_contexts` row must link to one `thread_threads` row.
- Every migrated `thread_items` row must link to context and thread (when source context exists).
- Every migrated `thread_executions` row must link to context and thread.
- Every migrated `thread_steps` row must link to execution.
- Every migrated `thread_parts` row must link to step.

## 5) Verification rules

- count invariants:
- relation/link invariants:
- critical business invariants:

## 6) Rollout and safety

- dry-run gate:
- canary org:
- rollback trigger:
- rollback action:

## 7) Implementation decision

- generated transform language: `ts` or `python`
- reason:
