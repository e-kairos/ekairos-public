# Thread workflow smoke tests

This package validates that `@ekairos/thread` runs correctly in a Workflow runtime with:

- `Thread` engine orchestration
- AI SDK reactor path
- deterministic mocked model behavior
- persisted execution state in InstantDB
- stream chunk contract for custom thread chunks

## Required env

Set these in `packages/thread/tests/playwright/server/.env.local` or workspace root `.env.local`:

- `NEXT_PUBLIC_INSTANT_APP_ID` (or `INSTANT_APP_ID` / `INSTANTDB_APP_ID`)
- `INSTANT_APP_ADMIN_TOKEN` (or `INSTANT_ADMIN_TOKEN` / `INSTANTDB_ADMIN_TOKEN`)
- `INSTANT_PERSONAL_ACCESS_TOKEN` (for schema push/bootstrap scripts)

## Commands

Run the AI SDK mocked-model unit test:

```bash
pnpm --filter @ekairos/thread exec vitest run -c vitest.config.mts src/tests/thread.ai-sdk-reactor.instant.test.ts
```

Run the Workflow + Playwright smoke e2e:

```bash
pnpm test:e2e -- tests/thread-engine-ai-sdk.spec.ts --reporter=list
```

or using the dedicated script:

```bash
pnpm run test:e2e:thread-engine
```

Repeat for quick stability check:

```bash
pnpm run test:e2e:thread-engine:repeat
```

## What must pass

1. Unit test confirms configurable AI SDK reactor with `ai/test` mocked model.
2. Unit test confirms thread custom chunk contract emission:
   - starts with `data-context-id`
   - includes `tool-output-available`
   - includes `tool-output-error` in tool-failure scenario
   - ends with `finish`
3. E2E confirms Workflow runtime execution reaches `completed` state in:
   - success mode (`/api/internal/workflow/story-smoke`)
   - tool-error mode (`/api/internal/workflow/story-smoke?mode=tool-error`)
4. E2E confirms persisted rows exist for execution/steps/items and emitted chunks match the expected contract for each mode.
