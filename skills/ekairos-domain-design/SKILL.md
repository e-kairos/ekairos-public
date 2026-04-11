---
name: ekairos-domain-design
description: Design or refactor Ekairos domains, explicit runtimes, step-safe actions, and workflow entrypoints. Use when starting a new Ekairos app, composing subdomains, defining InstantDB schema/entities/links/rooms, exporting actions, or wiring a scaffold created with @ekairos/domain create-app.
---

# ekairos-domain-design

Use this skill to shape the app contract first and keep the operational path simple later.

## Start Here

When the app starts from zero, prefer the scaffold:

```bash
npx @ekairos/domain create-app my-app --next
```

That gives you the canonical file split:

- `src/domain.ts`
- `src/runtime.ts`
- `src/workflows/demo.workflow.ts`
- `instant.schema.ts`
- `DOMAIN.md`

## Design Rules

1. Define reads in the composed InstantDB graph.
2. Put writes and invariants behind domain actions.
3. Keep actions step-safe:
   `async execute({ runtime, input }) { "use step"; const scoped = await runtime.use(appDomain); ... }`
4. Export action definitions separately when workflows need to call them directly.
5. Let workflows orchestrate actions with `executeRuntimeAction(...)`; do not materialize `runtime.use(...)` inside `"use workflow"` bodies.
6. Use an explicit runtime class that extends `EkairosRuntime`.
7. Keep `configureRuntime(...)` only as the route/bootstrap bridge for the well-known endpoint.

## Fast Review Checklist

- Does the domain name describe a bounded context instead of a page or transport?
- Are entity names stable and easy to query from InstaQL?
- Are cross-entity writes hidden behind actions?
- Can the app be inspected through `ekairos-domain inspect` without extra setup?
- Is there a `DOMAIN.md` that explains the intent of the graph?

## Validate Early

After editing the model, validate through the CLI instead of staring at types:

```bash
npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty
npx @ekairos/domain query "{ app_tasks: { comments: {} } }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Read Next

- Read `references/patterns.md` for the recommended runtime, action, and workflow snippets.
