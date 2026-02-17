# Ekairos Skills Catalog

This file is the distribution index for skills shipped from this workspace.

Use `./skill.sh` to list, validate, bundle, and install skills.

## Core Skills

### ekairos.domain.query

- Path: `skills/ekairos.domain.query`
- Purpose: Query domain data through `/.well-known/ekairos/v1/domain`.
- Adoption value: fast diagnostics and scoped reads without direct DB embedding in each consumer.
- Related packages:
  - `@ekairos/domain`
  - `@ekairos/ekairos`
  - `@ekairos/thread`
  - `@ekairos/structure`

### esolbay-thread-migration

- Path: `skills/esolbay-thread-migration`
- Purpose: Integrate new Ekairos versions in Esolbay with zero-downtime migration.
- Includes:
  - one-command orchestrator (`run_migration_pipeline.mjs`) with per-step status,
  - case-by-case runbook generation (`build_case_runbook.mjs`) with intermediate manual actions,
  - auto schema resolution from `esolbay-platform/instant.schema.ts` (override optional),
  - non-destructive apply by default (`delete` ops blocked unless explicitly allowed),
  - env bootstrap from `.env*` (human-supervised),
  - Clerk org -> Instant app matrix planning (`planSchemaPush` per app),
  - automatic failure diagnostics (`schema_duplicate_link`, `invalid_admin_token`, etc),
  - two-phase schema rollout guidance for legacy-vs-target link identity collisions,
  - automatic phase-1 transitional schema generator (`generate_phase1_schema.mjs`),
  - schema impact plan via Instant Platform `planSchemaPush`,
  - optional generation of next migration skill draft from plan output,
  - optional dataset extraction/transform/apply/verify scripts (explicit args only).
- Related packages:
  - `@ekairos/thread`
  - `@ekairos/domain`
  - `@ekairos/structure`
  - `@ekairos/story`

## Distribution Commands

```bash
./skill.sh list
./skill.sh validate esolbay-thread-migration
./skill.sh bundle esolbay-thread-migration
./skill.sh install esolbay-thread-migration
```

## Required Env

Planning minimum:

- `CLERK_SECRET_KEY`

No other env vars are required by script code.
