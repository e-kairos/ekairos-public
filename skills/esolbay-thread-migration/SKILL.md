---
name: esolbay-thread-migration
description: Execute or validate Esolbay story-to-thread migrations with hot-deploy safety as default behavior. Use when planning release readiness, generating per-org schema push plans, diagnosing blocked apps, building case-by-case migration runbooks, and producing deterministic migration status evidence before production rollout.
---

# esolbay-thread-migration

This skill is strictly scoped to the story -> thread migration and planning gates.

## Scope

- Deprecate `@ekairos/story` usage in the target migration surface.
- Adopt `@ekairos/thread` runtime (reactor can be implicit/default from thread engine).
- Preserve current UX semantics for send events, streaming, and state handling.
- Generate migration planning artifacts by organization/app.
- Run full pre-push/pre-migration validation bundle before any mutation.
- Keep human-supervised execution for any data mutation.

## Allowed env

Only these env vars are consumed by scripts:

- `CLERK_SECRET_KEY`

No other env vars are required or read by script code.

## Pipeline mode

`run_migration_pipeline.mjs` is planning + pre-migration-validation (non-mutating).

It runs:

1. `verify_env`
2. `preflight_scan`
3. `plan_story_thread_model_migration`
4. `plan_schema_push_org_matrix`
5. `diagnose_plan_failures`
6. `build_case_runbook`
7. `assert_hot_deploy_safe`
8. `report_migration_status`
9. `validate_pre_migration_bundle` (requires `--org-ids`)

## Main command

```powershell
node scripts/run_migration_pipeline.mjs --mode planning --org-ids <clerk-org-id>
```

## Temporary Migration Domain (execution)

The skill now supports execution with a dedicated temporary InstantDB app that stores migration runs, steps, artifacts, and reports as migration-domain entities.

```powershell
node scripts/run_temp_domain_migration.mjs --org <clerk-org-id> --schema-file <path-to-instant.schema.ts>
```

This command returns:

- `targetAppId`
- `targetAdminToken`
- `migrationAppId` (temporary app)
- `migrationAdminToken`
- `reportFromMigrationDomain` (queried only from migration-domain entities)

Hot-safe gates are enforced by default. Use `--allow-unsafe` only for diagnostics.

Run for a single org (recommended for controlled rollout):

```powershell
node scripts/run_migration_pipeline.mjs --mode planning --org-ids <clerk-org-id> --run-id <run-id>
```

## Mandatory Pre-Migration Validation Bundle

Validation is non-mutating and must include all pre-push/pre-migration evidence:

1. Backup current schema (`schema/pull`)
2. Backup current permissions (`perms/pull`)
3. Generate and persist `schema/plan` against target schema
4. Extract source dataset from target app (admin query)
5. Transform source dataset to thread model
6. Create deterministic tx plan file
7. Execute tx dry-run check
8. Run verify query snapshot (before migration)

Standalone command:

```powershell
node scripts/validate_pre_migration_bundle.mjs --org <clerk-org-id> --schema-file <path-to-instant.schema.ts> --run-id <run-id>
```

Artifacts are persisted under:

- `artifacts/runs/<runId>/01-extract/*`
- `artifacts/runs/<runId>/02-transform/*`
- `artifacts/runs/<runId>/03-apply/*`
- `artifacts/runs/<runId>/04-verify/*`
- `artifacts/reports/pre-migration-validation.<runId>.<org>.json`

## Default Policy

- Planning first, mutation later.
- Agent is the migration orchestrator (`plan -> execute one action -> verify -> decide next action`).
- Block rollout when matrix has blocked/failed rows.
- Require status evidence (`blocked_plan`, `planned_only`, `applied_unverified`, `migrated_verified`).
- Keep manual supervision for non-dry-run operations.
- Capture new failure signatures and successful remediations into a scenario registry after each run.

## Agent Orchestration Contract

The agent decides the next step using only persisted evidence from the current run:

1. Read latest artifacts (`schema.plan.before-push`, `platform-api.schema-push`, `verify.result`).
2. Classify scenario by signature (`error type + endpoint + entity/link target + trace id presence`).
3. Select one deterministic action from runbook/registry.
4. Execute one action only.
5. Verify and persist outcome before moving to the next action.

No blind retries. No hidden fallbacks. Every action must be explainable from artifacts.

## Scenario Registry (learning loop)

After each migration run, update scenario memory so repeated cases execute faster:

```powershell
node scripts/update_scenario_registry.mjs --reports-glob ".\\artifacts\\reports\\migration.temp-domain.*.json"
```

Generated outputs:

- `artifacts/reports/scenario-registry.json`
- `references/scenario-registry.md`

## Planning artifacts

- `artifacts/reports/pipeline.<runId>.json`
- `artifacts/reports/story-thread-model-plan.json`
- `artifacts/reports/story-thread-model-plan.md`
- `artifacts/reports/schema-plan-org-matrix.json`
- `artifacts/reports/schema-plan-org-matrix.md`
- `artifacts/reports/schema-plan-diagnostics.json`
- `artifacts/reports/schema-plan-diagnostics.md`
- `artifacts/reports/migration-case-runbook.json`
- `artifacts/reports/migration-case-runbook.md`
- `artifacts/reports/hot-deploy-gates.json`
- `artifacts/reports/migration-status.json`

## Run Evidence Package

Every migration run must be reproducible with a single `runId`.

Persist and group evidence under:

- `artifacts/runs/<runId>/manifest.json`
- `artifacts/runs/<runId>/01-extract/*`
- `artifacts/runs/<runId>/02-transform/*`
- `artifacts/runs/<runId>/03-apply/*`
- `artifacts/runs/<runId>/04-verify/*`

## Migration status by app/org

Generate a deterministic status report:

```powershell
node scripts/report_migration_status.mjs --matrix .\artifacts\reports\schema-plan-org-matrix.json --out .\artifacts\reports\migration-status.json
```

Output states:

- `blocked_plan`
- `planned_only`
- `applied_unverified`
- `migrated_verified`

## Resource Map

- `references/release-checklist.md`: release/no-go and rollback checklist.
- `references/before-after-contract.md`: mandatory mapping and invariants for transform/apply scripts.
- `references/scenario-registry.md`: known scenario signatures -> deterministic actions.
- `scripts/_run_artifacts.mjs`: run evidence writer utilities.
- `scripts/run_migration_pipeline.mjs`: canonical orchestration entrypoint.
- `scripts/update_scenario_registry.mjs`: refresh scenario registry from migration run reports.

## Focused app planning (optional)

Use explicit args (no env fallback):

```powershell
node scripts/plan_schema_push.mjs --app-id <instant-app-id> --admin-token <instant-admin-token> --schema-file <absolute-or-relative-instant.schema.ts> --out .\artifacts\reports\schema-plan.json --instructions-out .\artifacts\reports\schema-plan.instructions.md --run-id <run-id>
```

## Failure diagnostics

Use this after matrix generation to get actionable root-cause breakdown:

```powershell
node scripts/diagnose_plan_failures.mjs --matrix .\artifacts\reports\schema-plan-org-matrix.json --schema-file <absolute-or-relative-instant.schema.ts> --clerk-secret <clerk-secret-key> --out .\artifacts\reports\schema-plan-diagnostics.json --out-md .\artifacts\reports\schema-plan-diagnostics.md --run-id <run-id>
```

Current known blockers:

- `schema_duplicate_link`
- `invalid_admin_token`
- `instant_app_not_found`
- `conversation_history_orphan` (messages exist in `conversation_messages`/`whatsapp_messages` but no `thread_contexts` + `thread_items` for award timeline)

### `schema_duplicate_link` resolution contract

This blocker is usually a legacy-vs-target identity collision on the same entity/label (for example `organization_organizations->externalConnections`).

Required handling in this skill:

1. Detect the legacy owner identity from `schema/pull` refs.
2. Generate a **two-phase schema plan**:
   1. Phase 1: remove only the new conflicting link(s) from target schema and plan/apply this transitional schema.
   2. Phase 2: rerun planning with full target schema and require clean result before execution wave.
3. Store diagnostics and phase hints in:
   - `schema-plan-diagnostics.json`
   - `schema-plan-diagnostics.md`

Generate the phase 1 transitional schema helper (manual case step):

```powershell
node scripts/generate_phase1_schema.mjs --schema-file <absolute-or-relative-instant.schema.ts> --diagnostics .\artifacts\reports\schema-plan-diagnostics.json --out .\artifacts\reports\schema-phase1.json --out-md .\artifacts\reports\schema-phase1.md
```

Generate a case-by-case runbook (intermediate actions per org/app):

```powershell
node scripts/build_case_runbook.mjs --matrix .\artifacts\reports\schema-plan-org-matrix.json --diagnostics .\artifacts\reports\schema-plan-diagnostics.json --schema-file <absolute-or-relative-instant.schema.ts> --out .\artifacts\reports\migration-case-runbook.json --out-md .\artifacts\reports\migration-case-runbook.md
```

### `conversation_history_orphan` resolution contract

When tender timeline is empty but legacy conversation/whatsapp messages exist:

1. Resolve `awardId` for target `tenderId`.
2. Build canonical context key: `award_<awardId>`.
3. Upsert `thread_threads` + `thread_contexts`.
4. Backfill `thread_items` from `whatsapp_messages` in matching conversation.
5. Link `conversation_messages` -> `context` + `event`.
6. Verify with the same query shape used by timeline (`thread_items where context.key = award_<awardId>`).

Command:

```powershell
node scripts/migrate_conversation_history_to_thread.mjs --org <clerk-org-id> --tender-id <tender-uuid> --run-id <run-id>
```

## Optional execution scripts (manual, arg-driven)

Execution scripts are available but require explicit parameters:

- `extract_domain_dataset.mjs`
- `transform_story_to_thread_dataset.mjs`
- `apply_instant_tx.mjs`
- `verify_migration.mjs`
- `migrate_conversation_history_to_thread.mjs`

Examples:

```powershell
node scripts/extract_domain_dataset.mjs --org <clerk-org-id> --env production --base-url <app-base-url> --query-file .\queries\source.json --out .\artifacts\datasets\source.json --run-id <run-id>
node scripts/transform_story_to_thread_dataset.mjs --input .\artifacts\datasets\source.json --output .\artifacts\transformed\story-thread-target.json --org <clerk-org-id> --env production --run-id <run-id>
node scripts/apply_instant_tx.mjs --app-id <instant-app-id> --token <instant-admin-token> --input .\artifacts\transformed\story-thread-target.json --dry-run --org <clerk-org-id> --env production --run-id <run-id>
node scripts/verify_migration.mjs --org <clerk-org-id> --env production --base-url <app-base-url> --verify-file .\queries\verify.json --out .\artifacts\reports\verify.json --run-id <run-id>
```

## Safety rules

- `apply_instant_tx` blocks `delete` operations unless `--allow-destructive` is explicitly provided.
- Keep dry-run and human sign-off before any non-dry-run mutation.
- Roll out by org waves after matrix gating.
- Pipeline blocks by default when static scan still detects Story/model legacy refs or when org-matrix has blocked/failed plans.
- This skill does not auto-apply schema changes or Clerk metadata changes.
- Execute intermediate migration actions case by case using the generated runbook.

## Success criteria

- No blocking story imports in migration scope.
- Matrix planning available for all Clerk orgs.
- Target rollout wave is safe (or explicitly approved).
- Endpoint and agent paths are thread-backed with reactor configuration.
- Build/tests pass in worktree before merge.

