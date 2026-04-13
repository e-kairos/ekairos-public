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
- adopt new context package,
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

- `ekairos-workspace` publishes the reusable runtime/domain/context packages.
- `esolbay-platform` consumes released versions and receives feature + migration in the same PR.
- Rollout is canary-first and org-scoped (Clerk organizations), then expanded.

## Release Rules

- Package release from workspace: `pnpm ship:patch|minor|major|beta`.
- Production rollout in Esolbay: `push` to `main` (after validation gate).

## Core Integration / Remote Mobile Loop

`C:\ek` is the integration app where remote mobile work happens. When changing reusable package behavior here, especially `@ekairos/openai-reactor` or `@ekairos/sandbox`, follow this loop:

1. Implement package changes in this workspace on `development`.
2. Validate locally.
3. Push `development`.
4. Wait for GitHub `Publish Packages` to pass.
5. Verify npm beta versions with `npm view @ekairos/<package>@beta version`.
6. Update `C:\ek` to the published beta before validating product behavior.

Current remote mobile target in `C:\ek`:

- `http://192.168.1.23:3000/mobile-codex`
- React page in `C:\ek\packages\web\src\pages\mobile-codex.tsx`
- Mobile endpoints under `C:\ek\packages\web\src\app\api\mobile\codex`

Current Codex reactor state:

- `@ekairos/openai-reactor` supports remote app-server mode and sandbox mode.
- Sandbox mode supports Sprites and Vercel Sandbox.
- The app-server stays internal to the sandbox; a turn runner executes inside the sandbox and streams provider events back through persisted process output.
- Real test location: `packages/reactors/openai-reactor-real-tests/codex.reactor.sandbox.integration.test.ts`.
- Script: `pnpm --filter @ekairos/openai-reactor run test:reactor:sandbox`.

Do not mock the Codex sandbox path when the request is to validate it. The accepted proof is a real sandbox, copied `auth.json`, real `codex`, real `npx @ekairos/domain@beta create-app`, app URL reachable, CLI query against that URL, and Codex modifying the remote repo.
