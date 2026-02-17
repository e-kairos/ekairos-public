# AGENTS.md - Ekairos Workspace Identity

This workspace defines reusable Ekairos capabilities for production platforms.

## Identity

Ekairos is not only an orchestration framework.  
Ekairos is also a **Database Migration Service** for domain-driven, continuously evolving apps.

Core promise:

- iterate domain/schema fast,
- keep data safe and traceable,
- migrate production orgs without downtime,
- ship feature code and migration scripts together.

## Strategic Positioning

Ekairos helps teams make data decisions while application domains evolve.

- Domain schema evolves through code.
- Data migrations are first-class deliverables.
- Migrations run with admin runtime permissions and auditable traces.
- Dataset extraction + transformation + transaction application are standardized.

## Pragmatic Focus (Current Delivery)

Current release scope is intentionally narrow:

- deprecate story usage where required,
- adopt new thread package,
- deliver required migration and verification artifacts.

Do not expand to full autonomous orchestration in this phase.

## Virtuous Loop (Target)

Target architecture for upcoming iterations:

- project tasks sourced from management/Linear,
- AI-driven execution loop per task,
- migration/test/report as reusable skills,
- autonomous agent designed later from this validated operator loop.

## Migration Model

Every migration should include:

1. Runtime resolution with admin permissions.
2. Schema dry-run planning (`planSchemaPush`) per app.
3. Clerk organization matrix resolution (`org -> appId/adminToken`) and per-org gate.
4. Dataset extraction (via `/domain` or direct InstantDB admin queries).
5. Deterministic transformation (typically Python or TS).
6. Idempotent transaction plan for target schema.
7. Verification queries and migration report.

## Esolbay Collaboration Model

- `ekairos-workspace` publishes the reusable runtime/domain/thread packages.
- `esolbay-platform` consumes released versions and receives feature + migration in the same PR.
- Rollout is canary-first and org-scoped (Clerk organizations), then expanded.

## Release Rules

- Package release from workspace: `pnpm ship:patch|minor|major|beta`.
- Production rollout in Esolbay: `push` to `main` (after validation gate).
