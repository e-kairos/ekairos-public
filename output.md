## Version

- **Current workspace version**: `1.16.2-beta.0`
- **Last published npm version**: `1.16.1-beta.0`

## Changes vs `1.16.0`

- **Agent factory API**
  - Added a strongly-typed `agent(config)` factory in `@ekairos/story`, returning a `Story`/`Agent` instance built from:
    - `context(context: StoredContext<any>) => Context`
    - `systemPrompt(context: StoredContext<Context>) => string`
    - `tools(context: StoredContext<Context>, dataStream) => Record<string, Tool>`
    - Optional `model` and `opts`
  - Preserves the existing abstract `Story` / `Agent` class API for backwards compatibility while enabling a more modern, config-based TS style.

- **Eval / testing harness**
  - In `packages/web` (consumer app), added `simpleAgentConfig` using the new factory (`agent(simpleAgentConfig)`) to drive end‑to‑end style tests against a real `ekairos` install.
  - Introduced `testToolsWithContext` and `testWithConversation` helpers to:
    - Assert tools returned for a given typed context.
    - Evaluate system prompts and conversation behaviour without relying on fixture files or datasets.
  - Added a fast eval suite `tests/evals/simple-agent.eval.test.ts` wired into `pnpm test`, so `prepare-publish` and `ship:*` always validate the agent API surface.

- **Build / TS configuration**
  - Updated `packages/story/tsconfig.json` to include `"lib": ["ES2020", "DOM"]`, fixing type errors around `Response.ok/text/json/arrayBuffer/status` in:
    - `src/document-parser.ts`
    - `src/events.ts`
  - Ensures the story/document parsing pipeline compiles cleanly in the package build step used by `ship:*`.

## NPM Libraries Generated & Published

- **Generated (local build used in this cycle)**
  - `@ekairos/story@1.16.0` (built via `pnpm --filter @ekairos/story build`)
  - `@ekairos/domain@1.16.0` (built via `pnpm --filter @ekairos/domain build`)
  - `ekairos@1.16.0` (built via `pnpm --filter ekairos build`)

- **Published to npm (latest beta)**
  - `@ekairos/domain@1.16.1-beta.0`
  - `@ekairos/story@1.16.1-beta.0`
  - `ekairos@1.16.1-beta.0`

> Note: the workspace was bumped to `1.16.2-beta.0` and all tests + `prepare-publish` are passing.  
> The final `ship:beta` step is currently blocked only by a non‑clean git working directory (tracked files under `packages/ekairos/node_modules`), not by build or test failures. Once the repository is cleaned or those dependency updates are committed, rerunning `pnpm ship:beta` will produce and publish the next beta from this state.


