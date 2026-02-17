# Workflow Template (AI Session)

This package is the per-session template used by the agent to generate durable workflows.

## Key Rules
- The AI writes **TypeScript** directly in `src/session.workflow.ts`.
- The workflow function must include the `"use workflow"` directive.
- Any I/O must live inside `"use step"` functions.
- Avoid static imports inside modules that contain `use workflow` / `use step`.

## Compile
```
pnpm compile
```

## Run (local world)
```
pnpm run:local
```

Input is read from `WORKFLOW_INPUT` (JSON) or env vars:
`ORG_ID`, `EKAIROS_DOMAIN_BASE_URL`, `EKAIROS_DOMAIN_OIDC_TOKEN`, `QUERY`.
