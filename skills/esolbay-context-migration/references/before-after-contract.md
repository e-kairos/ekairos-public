# Before/After Migration Contract

Use this file as the mandatory input for migration code generation.

## 1) Release scope

- from version:
- to version:
- feature scope: story deprecated -> context package adoption

## 2) Before (current state)

- runtime entrypoints:
- domain/schema entities in use:
- story APIs currently used:
- data invariants currently guaranteed:

## 3) After (target state)

- runtime entrypoints:
- context APIs adopted:
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

### Mandatory story -> context entity mapping

Use this mapping as baseline unless explicitly overridden by release notes:

| Legacy entity | Target entity | Required notes |
| --- | --- | --- |
| `context_contexts` | `context_contexts` + `context_contexts` | preserve context id, preserve key/title/status, create deterministic context id |
| `context_events` | `context_items` | preserve ids and message ordering (`createdAt`) |
| `story_executions` | `context_executions` | preserve workflow run metadata and status |
| `story_steps` | `context_steps` | preserve iteration + event linkage + tool metadata |
| `story_parts` | `context_parts` | preserve normalized parts and per-step ordering (`idx`) |

### Mandatory link invariants

- Every migrated `context_contexts` row must link to one `context_contexts` row.
- Every migrated `context_items` row must link to context and context (when source context exists).
- Every migrated `context_executions` row must link to context and context.
- Every migrated `context_steps` row must link to execution.
- Every migrated `context_parts` row must link to step.

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
