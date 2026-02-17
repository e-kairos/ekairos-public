# Registry Git Integration Plan

## Objective
Enable "transactions via Git" where the registry state in InstantDB is populated and updated by syncing with external Git repositories containing `components.json` and component source code.

## Workflow

1.  **Repository Registration**:
    *   Admin registers a Git repository URL in the Registry UI.
    *   System stores it in `registry_repositories`.

2.  **Sync Process (Transaction Trigger)**:
    *   Triggered via Webhook (GitHub Actions/Webhooks) or manual "Sync" button.
    *   **Action**: `POST /api/internal/registry/sync` with `{ repoId }`.

3.  **Sync Execution (Server-side)**:
    *   **Clone/Fetch**: The service clones the repo to a temporary directory.
    *   **Read Config**: Parses `components.json` to find registry items.
    *   **Process Items**:
        *   For each item defined in `components.json`:
            *   Read source files (`files` array in `components.json`).
            *   Read metadata (`name`, `dependencies`, etc.).
            *   Calculate hash of content to detect changes.
            *   **Resolve Dependencies**:
                *   For each external dependency (e.g., "zod"):
                    *   Check if `registry_packages` exists for "zod@version".
                    *   If not, create it.
                    *   Store ID for linking.
                *   For each registry dependency (e.g., "button"):
                    *   Find `registry_components` by name "button".
                    *   Store ID for linking.
            *   **Upload Files**:
                *   For each file, check if content changed (via hash or previous commit).
                *   If changed, upload to InstantDB Storage (`db.storage.uploadFile`).
                *   Get Storage ID (`$files` id).
    *   **DB Transaction**:
        *   Start InstantDB transaction.
        *   **Upsert Component**: Create or update `registry_components` entry.
        *   **Link Dependencies**:
            *   Link component -> `registry_packages` (external).
            *   Link component -> `registry_components` (internal).
        *   **Upsert Files**: 
            *   Create or update `registry_files` entries.
            *   Link `registry_files` -> `$files` (Storage).
        *   **Record Commit**: Create `registry_commits` entry with current HEAD info.
        *   Link Component -> Commit (to show "Last updated in...").
    *   **Cleanup**: Remove temporary files.

## Data Mapping

| Git Source | InstantDB Entity | Field | Note |
| :--- | :--- | :--- | :--- |
| `components.json` item | `registry_components` | `name`, `type`, `title` | |
| `components.json` dependencies | `registry_packages` | `name`, `version` | Linked via `componentPackages` |
| `components.json` registryDependencies | `registry_components` | - | Linked via `componentRegistryDeps` |
| Source file content | `$files` | - | Uploaded to Storage |
| Source file metadata | `registry_files` | `path`, `type`, `target` | Linked to `$files` via `fileStorage` |
| `git log -1` | `registry_commits` | `hash`, `message`, `author`, `date` | |

## Service Methods (`RegistryService`)

- `syncFromGit(repoId: string)`: Main orchestrator.
- `ensurePackage(name: string, version: string)`: Helper to find/create library entity.
- `ensureRegistryDep(name: string)`: Helper to find component entity.
- `uploadFileToStorage(path: string, content: string)`: Helper to upload.
- `parseComponentsJson(path: string)`: Helper to read config.
- `readComponentFiles(basePath: string, files: string[])`: Helper to read content.

## Future Enhancements
- Incremental sync (compare commits).
- Webhook signature verification.
- Branch selection (default: `main` or `master`).
