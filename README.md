# Pulzar Lib Core - Monorepo

Monorepo of libraries for the Pulzar/Ekairos agents and stories system.

## Current Delivery Focus

Immediate pragmatic goal for client upgrades:

- migrate deprecated story usage to thread package,
- ship migration + verification artifacts with each upgrade,
- validate in worktrees before production rollout.

Long-term goal remains autonomous task execution loops, but current phase optimizes for safe and fast upgrade execution.

## Releases

Publishing is main-centric and automated from GitHub Actions.
Push a version change to `main` and CI publishes with the channel inferred from version suffix.

Canonical release guide: [`RELEASE.md`](./RELEASE.md)

Quick commands:

- `pnpm release -- --channel beta`
- `pnpm release -- --channel rc`
- `pnpm release -- --channel next`
- `pnpm release -- --channel latest`
- `pnpm publish:beta`
- `pnpm publish:rc`
- `pnpm publish:next`
- `pnpm publish:latest`
- `pnpm publish:dry-run:beta`
- `pnpm release:check -- --tag beta`

## 📦 Packages

### `ekairos` (Main Package)
**The core package** that includes:
- 🤖 **Agent/Story**: Durable AI agent system
- 🎭 **Story Engine**: Modular story system with workflows
- 🔧 **Steps**: Primitives for building durable workflows
- 📊 **Schema & Service**: InstantDB domain for contexts, events, and executions
- 📝 **Document Parser**: Document processing with LlamaCloud
- 🏗️ **Domain Utilities**: Utilities to define InstantDB schemas

**Install:**
```bash
pnpm add ekairos
```

**Usage:**
```typescript
import { story, engine, storyRunner, domain } from 'ekairos';
import { Agent } from 'ekairos'; // Legacy class
```

### `@ekairos/dataset` (Separate Package)
Specialized tools for AI dataset processing:
- 📊 Schema generation
- 🔄 Dataset transformation
- 🐍 Python scripts for data preview
- 🤖 Specialized agents (FileDatasetAgent, TransformDatasetAgent)

**Install:**
```bash
pnpm add @ekairos/dataset
```

**Usage:**
```typescript
import { DatasetService } from '@ekairos/dataset';
import { FileDatasetAgent } from '@ekairos/dataset';
```

### Internal Packages (Advanced Usage)
- **`@ekairos/story`** - Modular story + workflow engine (see [dedicated section](#-ekairosstory))
- **`@ekairos/domain`** - InstantDB domain DSL (see [dedicated section](#-ekairosdomain))

## 🧩 @ekairos/domain

Source code: `packages/domain`. This package exposes the `domain()` helper to describe InstantDB entities, links, and rooms with typed composition. It is published on npm as `@ekairos/domain`.

**Install**
```bash
pnpm add @ekairos/domain
```

### Recommended flow
1. **Create a named builder (optional):** `domain("app")` registers the domain and enables lazy includes to handle cross-dependencies.
2. **Include other domains:** `includes(storyDomain)` or any `DomainInstance`/`DomainDefinition`. This is used to extend `storyDomain` or your own modules.
3. **Define the local schema:** `schema({ entities, links, rooms })` validates that all links point to available entities (including `$users` and `$files`).
4. **Publish the schema to InstantDB:** `domainInstance.toInstantSchema()` generates the object accepted by InstantDB `init()` (admin/client).

### Full example
```typescript
import { i } from "@instantdb/core";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { storyDomain } from "ekairos/story";

const appDomain = domain("app")
  .includes(storyDomain)
  .schema({
    entities: {
      project: i.entity({
        name: i.string().indexed(),
        status: i.string().optional(),
      }),
    },
    links: {
      project_owner: {
        forward: { on: "project", has: "one", label: "owner" },
        reverse: { on: "$users", has: "many", label: "projects" },
      },
    },
    rooms: {},
  });

export const schema = appDomain.toInstantSchema();

export const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});
```

Additional features:
- `compose()` lets you combine classic domains without losing link literals.
- `includes(() => otherDomain)` supports circular dependencies thanks to deferred resolution before `toInstantSchema()`.
- The builder automatically adds base entities `$users` and `$files`, which lets you create links to users/files without boilerplate.

## 🚀 Development

### Initial setup
```bash
cd c:\Users\aleja\storias\projects\pulzar\pulzar-lib-core
pnpm install
pnpm build
```

### Available commands
```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @ekairos/story build

# Dev mode (watch) for all packages
pnpm dev

# Dev mode for a specific package
pnpm --filter @ekairos/story dev

# Clean builds
pnpm clean

# Typecheck
pnpm typecheck

# Run the example workbench
pnpm --filter @ekairos/example-workbench dev
```

## 🎯 Workbench

The `workbench/example` directory contains a working example of how to use `@ekairos/story` with the story + workflow engine.

```bash
pnpm --filter @ekairos/example-workbench dev
```

## 🎬 @ekairos/story

Source code: `packages/story`. This package extracts the durable story engine so it can be installed as `@ekairos/story` in any app (including, but not limited to, `ekairos`). It publishes the helpers `story()`, `engine`, `storyRunner()`, `Agent`, `storyDomain`, and durable steps.

**Install**
```bash
pnpm add @ekairos/story
```

### Key components
- `storyDomain` (`packages/story/src/schema.ts`): InstantDB entities for contexts, events, and executions.
- `story()` (`packages/story/src/story.ts`): describes narratives, actions/tools, and reasoning options.
- `engine.register()` (`packages/story/src/storyEngine.ts`): registers non-serializable runtime/execute callbacks and returns a serializable descriptor.
- `storyRunner()` (`packages/story/src/storyRunner.ts`): workflow ready for `workflow/next` that runs the AI loops while respecting the registered actions.

### 1. Register `storyDomain` in InstantDB

```typescript
// lib/domain.ts
import { domain } from '@ekairos/domain';
import { storyDomain } from 'ekairos/story';
import { workflowDomain } from './domain/workflow/schema';

export const appDomain = domain('app')
  .includes(workflowDomain)
  .includes(storyDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export const schema = appDomain.toInstantSchema();
```

### 2. Define and register a story

```typescript
// stories.ts
import { story, engine, type StoryActionSpec } from '@ekairos/story';

const myStory: {
  key: string;
  narrative: string;
  actions: StoryActionSpec[];
  options?: any;
  callbacks?: any;
} = {
  key: 'platform:my-story',
  narrative: 'Assistant that helps with...',
  actions: [
    {
      name: 'updateEntity',
      description: 'Updates an entity',
      implementationKey: 'platform.updateEntity',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', required: true, description: 'Entity ID' },
          title: { type: 'string', description: 'New title' },
        },
      },
      finalize: true,
      // Non-serializable function (runs at runtime)
      execute: async ({ id, title, contextId }) => {
        // Side-effect code: DB, APIs, etc.
        console.log(`Updating ${id} with title ${title}`);
        return { success: true };
      },
    },
  ],
  options: {
    reasoningEffort: 'medium',
    maxLoops: 10,
    includeBaseTools: {
      createMessage: true,
      requestDirection: true,
      end: true,
    },
  },
  callbacks: {
    evaluateToolCalls: async (toolCalls) => ({ success: true }),
    onEnd: async (lastEvent) => ({ end: true }),
  },
};

// Register in the global engine
export const storyEngineInstance = engine.register(myStory);
export const storyDescriptor = storyEngineInstance.story('platform:my-story');
```

### 3. Create a workflow with Next.js + Workflow DevKit

```typescript
// app/workflows/my-story.ts
import { storyRunner } from '@ekairos/story';
import { storyDescriptor } from '@/stories';

export async function myStoryWorkflow(args?: { context?: any }) {
  "use workflow"; // Directive for the Next.js loader
  return storyRunner(storyDescriptor, args);
}
```

### 4. Configure Next.js

```typescript
// next.config.ts
import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ekairos/story', '@ekairos/domain', '@ekairos/dataset'],
};

export default withWorkflow(nextConfig);
```

### 5. Trigger the workflow

```typescript
// route.ts or server action
import { start } from 'workflow/api';
import { myStoryWorkflow } from '@/app/workflows/my-story';

export async function POST() {
  const run = await start(myStoryWorkflow, [{ context: null }]);
  return Response.json({ runId: run.runId });
}
```

## 🏗️ Architecture

```
@ekairos/story           (Main package)
  ├── Agent/Story        (Legacy durable agents)
  ├── Story Engine       (Modular story system)
  ├── Story Runner       (Workflow with "use workflow")
  ├── Steps              (Primitives: ai, base, registry, context)
  ├── Schema & Service   (DB: story_contexts, story_events, story_executions)
  └── Document Parser    (LlamaCloud integration)

@ekairos/domain          (Schema utilities)
  └── domain()           (Function to create composable domains)

@ekairos/dataset         (Dataset tools)
  ├── Dataset Service
  ├── Dataset Agents     (File, Transform)
  └── Tools              (Clear, Complete, Execute, Generate Schema)
```

## 📝 Differences between Story API and Story Engine

### Story API (`Agent`/`Story` class)
Abstract class API for conversational agents with streaming:

```typescript
class MyAgent extends Agent<MyContext> {
  protected async buildSystemPrompt(context) { /* ... */ }
  protected async buildTools(context, dataStream) { /* ... */ }
  protected async initialize(context) { /* ... */ }
}
```

### Story Engine (`story()` function)
Functional API for modular stories with workflows:

```typescript
const myStory = story('key', {
  narrative: 'System prompt...',
  actions: [/* tools */],
  options: { /* ... */ }
});

// In workflow file:
export async function myWorkflow() {
  "use workflow";
  return storyRunner(descriptor, args);
}
```

## 🔄 Migration from the monolithic package

See [MONOREPO_MIGRATION.md](./MONOREPO_MIGRATION.md) for migration details.

## 📄 License

MIT

## 🔗 Links

- [Workflow DevKit](https://github.com/vercel/workflow) - Durable workflows system
- [InstantDB](https://www.instantdb.com/) - Database
