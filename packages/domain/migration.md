# Ekairos Domain Migration Guide

## Purpose

Define how Ekairos executes database migrations as a product capability:

- resolve runtime with admin permissions,
- extract datasets from current domain,
- transform data safely,
- apply transactions against target schema,
- verify and report.

This is the contract for migration work in client platforms (example: Esolbay).

## Database Migration Service

Ekairos migration is a service, not an ad-hoc script:

1. Read current production state.
2. Compute deterministic transformation.
3. Apply idempotent target transactions.
4. Keep full observability and rollback path.

## Runtime Resolution (Admin)

Runtime must be resolved using domain runtime wiring and privileged env.

### Required capabilities

- org-scoped admin access
- target app resolution (appId/env)
- read/write transactions
- trace/report emission

### Baseline interface

```ts
import { resolveRuntime } from "@ekairos/domain/runtime";
import { appDomain } from "./domain";

type MigrationEnv = {
  orgId: string;
  projectId?: string;
  envName: string;
  instantAppId?: string;
  instantAdminToken?: string;
  ekairosApiKey?: string;
};

const runtime = await resolveRuntime(appDomain, env as MigrationEnv);
```

When required, use direct admin runtime for bulk operations.

## Data Sources

Supported extraction modes:

1. **Domain endpoint**: `/.well-known/ekairos/v1/domain` + domain query API.
2. **Direct InstantDB admin**: admin queries for large/batch operations.
3. **Instant Platform schema planner**: `planSchemaPush` for dry-run schema impact steps.

Recommended:

- start with `/domain` for portable diagnostics and scoped reads,
- switch to direct admin query for high-volume migrations,
- always run `planSchemaPush` before apply to generate operator/agent actions.

## Migration Lifecycle

### 1) Discover

- collect source schema/domain descriptor,
- collect target schema/domain descriptor,
- identify entity/link/attribute deltas.
- generate schema push plan (`planSchemaPush`) and classify critical/warning steps.
- resolve Clerk organization mapping (`clerkOrgId -> appId/adminToken`) and run plan per org app.

### 2) Snapshot

- extract source datasets by entity/query,
- persist snapshots in migration artifacts,
- include metadata (orgId, envName, appId, timestamp, query hash).

### 3) Transform

- run deterministic transform scripts (Python/TS),
- output target-shaped records and tx payload candidates,
- include reject list with explicit reason.

### 4) Plan Transactions

- generate idempotent transaction batches,
- include stable identifiers and upsert strategy,
- split into bounded batch sizes.

### 5) Dry Run

- validate tx payload schema,
- estimate changed records,
- run verification queries over simulated/preview set.

### 6) Execute

- apply batches in controlled sequence,
- capture success/error per batch,
- stop on invariant violation.

### 7) Verify

- run post-migration queries,
- compare source/target counts and key invariants,
- emit migration report.

## No-Downtime Strategy

Use phased cutover:

1. Deploy code compatible with old+new schema.
2. Backfill new fields/entities.
3. Enable dual-read (or feature-flagged read switch).
4. Enable dual-write (if needed).
5. Flip reads to new schema by canary org.
6. Expand rollout.
7. Remove legacy paths in later cleanup release.

Never require global write freeze unless explicitly approved.

## Migration Deliverables

Each migration PR must include:

1. feature code for new schema behavior,
2. migration scripts (`extract`, `transform`, `apply`),
3. usage instructions (`runbook`),
4. verification queries + acceptance criteria,
5. rollback instructions.

Additionally, migration execution must persist audit records into a temporary InstantDB app:

- one `snapshot` record per script execution,
- one `final` record per script execution.

Recommended entity in temp app: `migration_audit_records`.

## Multi-Org Rollout (Clerk)

Execution unit is Clerk organization.

Recommended rollout order:

1. internal orgs
2. low-risk customer orgs
3. remaining production orgs in waves

Before rollout per wave:

- generate org matrix report from Clerk metadata,
- block wave if any org in wave has `blocked` gate,
- require explicit approval for `review` gate orgs.

Record migration state per org:

- pending
- running
- verified
- failed
- rolled_back

## Integration with ekairos/structure

Use `@ekairos/structure` for:

- dataset extraction normalization,
- structured transform pipelines,
- reproducible outputs for audit.

For each dataset, keep:

- source query
- transformation version
- target entity mapping
- mathematical set notation reference (optional but encouraged for formal reasoning)

## Suggested Script Contract

```txt
scripts/
  01-extract.mjs
  02-transform.py
  03-apply-tx.mjs
  04-verify.mjs
```

Inputs:

- orgId
- envName
- appId
- auth token(s)
- migration version
- migration run id

Outputs:

- datasets/*.json
- transformed/*.json
- tx-plan/*.json
- reports/*.json
- audit records in temp InstantDB app (`migration_audit_records`)

## Safety Rules

- idempotent writes only
- explicit batch boundaries
- retry with backoff for transient failures
- fail fast on invariant violations
- no destructive delete without backup artifact
