# Esolbay Migration Release Checklist

## Pre-release

- Confirm `@ekairos/thread` target version published from workspace.
- Confirm Esolbay dependency bump committed.
- Confirm `planSchemaPush` report exists (`schema-plan.json` + `schema-plan.instructions.md`).
- Confirm Clerk org matrix report exists (`schema-plan-org-matrix.json` + `.md`).
- Confirm migration scripts exist in PR (`extract`, `transform`, `apply`, `verify`).
- Confirm orchestrator report exists (`artifacts/reports/pipeline.<runId>.json` + `.md`).
- Confirm rollback flag/strategy documented.

## Validation

- Build succeeds in Esolbay.
- Critical tests for session/thread paths pass.
- Preflight scan (`thread + reactor`) report exists and is attached.
- Story->Thread model plan report exists (`story-thread-model-plan.json` + `.md`).
- Endpoint routes in migration scope are thread-backed (no runtime `@ekairos/story` usage).
- Agent runtime paths include explicit reactor configuration.
- UI parity verified for event send, stream resume, and context state/history.
- Legacy model migration completed:
  - `context_contexts` -> `thread_contexts` + `thread_threads`
  - `context_events` -> `thread_items`
  - `story_executions` -> `thread_executions`
  - `story_steps` -> `thread_steps`
  - `story_parts` -> `thread_parts`
- Human review completed for all `critical`/`warning` plan steps.
- All rollout-wave orgs resolved with `org -> appId/adminToken`.
- Matrix gate for rollout-wave orgs is `safe` (or explicitly approved `review`).
- Dry-run migration report generated for at least one canary org.
- Apply script executed in non-destructive mode by default (no `delete` ops unless explicitly approved with `--allow-destructive`).

## Production rollout

1. Deploy with new feature guarded (flag/allowlist).
2. Run migration for canary org.
3. Verify domain queries and thread execution.
4. Expand to additional org waves.
5. Mark migration status per org.

## Rollback

- Disable new behavior flag.
- Stop migration batch runner.
- Keep old read path active.
- Collect execution/context ids for incident trace.
