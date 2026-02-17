# Create Registry Domain - Task Plan

## Domain Analysis
- Domain name: `registry`
- Purpose: Manage shadcn-like registry components, repositories, and git history integration.
- Context: `pulzar-lib-core/packages/registry` application.
- Authentication: Clerk + InstantDB (using organization private metadata for credentials).

## Entities
- `registry_repositories`: Git repositories that act as sources.
- `registry_commits`: Commit history for auditing and versioning.
- `registry_components`: Component definitions (name, dependencies, metadata).
- `registry_files`: Metadata for source files, linked to `$files`.
- `$files`: InstantDB Storage entity for file content.
- `registry_packages`: External dependencies (NPM packages) with versioning (e.g. `zod@^3.0`).

## Implementation Plan

### Step 1: Authentication & Infrastructure (Clerk + InstantDB)
- [x] Implement `admin-org-db.ts` adapted for Registry (copy/adapt from `ekairos-core`).
- [x] Implement `client-org-db.ts` adapted for Registry.
- [ ] Update `app/layout.tsx` to handle `OrgSyncGuard` or similar logic to ensure DB credentials exist.
- [ ] Ensure redirect to `platform.ekairos.dev` if credentials are missing.

### Step 2: Schema Deployment
- [x] Define schema in `lib/domain/registry/schema.ts` (Modeled deps as entities, files as Storage).
- [x] Create `lib/domain.ts` to compose the full app schema.
- [ ] Push schema to InstantDB (`pnpm schema:push`).

### Step 3: Git Integration & Service Layer
- [ ] Create `RegistryService` in `lib/domain/registry/service.ts`.
- [ ] Implement methods:
  - `registerRepository(url, name)`
  - `syncFromGit(repoId)` (Handles `registry_packages` linking and file uploads to `$files`)
  - `createComponent(data)`
  - `updateComponent(id, data)`
  - `getComponent(name)`
- [ ] Implement "Transaction via Git" mechanism (Plan detailed in `registry_git_integration.md`).

### Step 4: API Routes
- [ ] `GET /api/registry/[id].json`: Dynamic registry endpoint backed by InstantDB.
  - Must reconstruct `dependencies` array from `registry_packages` links.
  - Must reconstruct `registryDependencies` array from component links.
  - Must fetch file content from Storage URL or serve cached content.
- [ ] `POST /api/internal/registry/sync`: Webhook or trigger to start git sync.

### Step 5: UI & Components
- [ ] Create UI to list repositories and components from InstantDB.
- [ ] Show git history/status.

## Execution Steps
1. ✅ Create `lib/domain/registry/schema.ts` (Updated with packages and storage)
2. ✅ Create `registry_git_integration.md`
3. ✅ Setup `lib/domain.ts` and Auth Infrastructure (`admin-org-db`, `client-org-db`)
4. ⏳ Push Schema
5. ⏳ Implement `RegistryService`
6. ⏳ Implement API Routes (`/registry/[id].json`)
7. ⏳ Implement UI

## Rollback Plan
- Revert schema changes.
- Delete created files.
