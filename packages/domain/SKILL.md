# Skill: ekairos-domain

## Goal
Provide consistent guidance for working with @ekairos/domain in agents and codegen.

## Minimum requirement
- Runtime is configured via `configureRuntime(...)` in app bootstrap (`src/runtime.ts` by convention).
- Always scope the database by calling `runtime(domain, env)`.

## Workflow
1) Identify the domain package and open its `DOMAIN.md`.
2) Start from the domain name and follow the documented entrypoints (Navigation/Responsibilities).
3) Import the domain schema (e.g. `threadDomain`) and call `runtime(domain, env)`.
4) Use the scoped `db` when calling exported functions/workflows from the domain package.
5) Use `meta()` or `domain.contextString()` for AI/system prompts if needed.

## Notes
- Domain runtime does **not** expose actions. Public API lives in package exports.
- `domain.toInstantSchema()` returns the flattened InstantDB schema for the composed domain.
- If you need strict typing for helpers, use `CompatibleSchemaForDomain` in function signatures.
