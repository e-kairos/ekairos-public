# @ekairos/sandbox

Provider-agnostic helpers to provision and manage external sandboxes with durable IDs stored in InstantDB.
This package is **independent** (no workflow runtime dependency). Other packages (e.g. `@ekairos/dataset`, `@ekairos/structure`)
may depend on it, but `@ekairos/sandbox` does not depend on any workflow framework.

---

## Why this package exists

We need a stable, provider-agnostic interface to:
- Create and reconnect sandboxes by a durable `sandboxId`.
- Run commands and read/write files in a consistent way.
- Persist sandbox metadata in InstantDB for continuity across runs.
- Support multiple providers (Vercel, Daytona, etc.) without changing callers.

---

## Installation (pnpm)

```bash
pnpm add @ekairos/sandbox
```

---

## Environment variables

### InstantDB (admin)
You must provide an InstantDB **admin** database client so sandbox actions can persist and query sandbox records.

### Provider selection

By default, provider is `sprites` unless overridden.

You can set:
- `SANDBOX_PROVIDER=sprites` or `SANDBOX_PROVIDER=daytona` or `SANDBOX_PROVIDER=vercel`
- or pass `provider` in `SandboxConfig`

### Sprites.dev

- `SPRITES_API_TOKEN` (or `SPRITE_TOKEN`) - required
- Optional:
  - `SPRITES_API_BASE_URL` / `SPRITES_API_URL` (default: `https://api.sprites.dev`)

### Daytona (current)

`@daytonaio/sdk` supports these env vars:

- `DAYTONA_API_URL` (required) - Daytona API base URL
- `DAYTONA_API_KEY` (required if not using JWT)
- `DAYTONA_JWT_TOKEN` + `DAYTONA_ORGANIZATION_ID` (optional auth mode)
- `DAYTONA_TARGET` (optional)
- `SANDBOX_DAYTONA_EPHEMERAL` (optional) - default ephemeral for Daytona sandboxes (true unless set to 0/false)

### Vercel

- `SANDBOX_VERCEL_TEAM_ID`
- `SANDBOX_VERCEL_PROJECT_ID`
- `SANDBOX_VERCEL_TOKEN`

---

## Data model (InstantDB)

### `sandboxDomain`
Defines a single entity:

- `sandbox_sandboxes`

Fields (high-level):
- `externalSandboxId` (string, indexed): provider sandbox id (Vercel `sandbox.sandboxId`, Daytona `sandbox.id`)
- `provider` (string, indexed): e.g. `"vercel"`, `"daytona"`
- `sandboxUrl` (string, optional): optional URL metadata
- `status` (string, indexed): `"creating" | "active" | "shutdown" | "error" | ...`
- `timeout` (number, optional): milliseconds
- `runtime` (string, optional): `"node22" | "python3" | ...`
- `vcpus` (number, optional)
- `ports` (json, optional): array of ports
- `purpose` (string, optional, indexed)
- `params` (json, optional)
- timestamps: `createdAt`, `updatedAt`, `shutdownAt`

---

## ID semantics (important)

There are two ids involved:

### 1) `sandboxId` (internal, durable handle)
- The **InstantDB record id**: `sandbox_sandboxes[sandboxId]`
- This is the id you store in durable state and pass around.
- All sandbox actions and helpers take this `sandboxId`.

### 2) `externalSandboxId` (provider id)
- The id returned by the provider SDK (Vercel `sandbox.sandboxId`, Daytona `sandbox.id`)
- Stored on the record as `externalSandboxId`
- Used internally to reconnect via the provider SDK

---

## Schema integration

In your app schema, include `sandboxDomain` along with other domains, then initialize Instant with the composed schema.

```ts
import { domain } from "@ekairos/domain";
import { sandboxDomain } from "@ekairos/sandbox";
// import { storyDomain } from "@ekairos/story" (if you use stories)
// import { datasetDomain } from "@ekairos/dataset" (if you use dataset)

export const appDomain = domain("app")
  .includes(sandboxDomain)
  // .includes(storyDomain)
  // .includes(datasetDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export const schema = appDomain.toInstantSchema();
```

---

## Exports

- `sandboxDomain` (schema domain + actions factory)
- `SandboxService` (high-level service)
- `runCommandInSandbox` (low-level helper for Vercel)
- Types: `SandboxConfig`, `SandboxRecord`, `ServiceResult<T>`, `CommandResult`

---

## Quickstart

### 1) Instantiate the service

```ts
import { init } from "@instantdb/admin";
import { sandboxDomain } from "@ekairos/sandbox";

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN,
  schema: {}, // your composed schema that includes sandboxDomain
});

const sandboxes = sandboxDomain(db);
```

### 2) Create a persisted sandbox

```ts
const created = await sandboxes.createSandbox({
  provider: "daytona", // or set SANDBOX_PROVIDER=daytona
  runtime: "node22",
  timeoutMs: 10 * 60 * 1000,
  resources: { vcpus: 2 },
  purpose: "dataset-file-parse",
  params: { datasetId: "..." },
});

if (!created.ok) throw new Error(created.error);
const { sandboxId } = created.data;
```

### 3) Run commands by `sandboxId`

```ts
const sandbox = sandboxes.getSandbox(sandboxId);
const res = await sandbox.runCommand("node", ["-e", "console.log('hello')"]);
if (!res.ok) throw new Error(res.error);
console.log(res.data.exitCode, res.data.output);
```

### 4) Reconnect (when you need the runtime object)

```ts
const sandbox = sandboxes.getSandbox(sandboxId);
const rec = await sandbox.reconnect();
if (!rec.ok) throw new Error(rec.error);

const { sandbox: providerSandbox } = rec.data;
// Use provider-specific SDK features on providerSandbox
```

### 5) Stop (optional)

```ts
const sandbox = sandboxes.getSandbox(sandboxId);
await sandbox.stop();
```

---

## Provider selection rules

Precedence:
1) `SandboxConfig.provider`
2) `SANDBOX_PROVIDER`
3) default: `sprites`

---

## Daytona provider details

### Config mapping

`SandboxConfig` accepts Daytona-specific options via `config.daytona`:

```ts
{
  provider: "daytona",
  runtime: "node22", // used to infer language when daytona.language not set
  daytona: {
    language: "typescript" | "javascript" | "python",
    snapshot: "snapshot-id",
    image: "debian:12" | "...",
    envVars: { KEY: "value" },
    labels: { "app": "ekairos" },
    public: false,
    ephemeral: true,
    autoStopIntervalMin: 30,
    autoArchiveIntervalMin: 60,
    user: "daytona",
    volumes: [{ volumeId: "vol-123", mountPath: "/home/daytona/volume" }],
  }
}
```

### Command execution

For Daytona, `runCommand` uses `sandbox.process.executeCommand(...)` and returns:

- `exitCode`
- `output` (stdout)
- `error` (stderr if available)

### File IO

- `writeFiles` -> `sandbox.fs.uploadFiles(...)`
- `readFile` -> `sandbox.fs.downloadFile(...)`

---

## Volumes (Daytona)

Volumes are persistent FUSE mounts that can be attached to multiple sandboxes.
They are ideal for caching datasets or large artifacts across runs.

### Create/get a volume

```ts
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona();
const volume = await daytona.volume.get("ekairos-ds-123", true);
```

### Mount a volume when creating a sandbox

```ts
const created = await sandboxes.createSandbox({
  provider: "daytona",
  daytona: {
    // Either volumeId or volumeName can be provided.
    volumes: [{ volumeId: volume.id, mountPath: "/home/daytona/.ekairos" }],
    // volumes: [{ volumeName: "ekairos-ds-123", mountPath: "/home/daytona/.ekairos" }],
  },
});
```

### Use the volume in the sandbox

Once mounted, read/write like any other directory.
Files written to a volume persist even after the sandbox is removed.

### Limitations

- Volumes are FUSE-based and **slower** than the local sandbox filesystem.
- Volumes are **not** block storage and are not suitable for databases.
- For heavy processing, consider copying from the volume to local FS first.

---

## Volumes vs InstantDB files (how they relate)

InstantDB storage (`$files`) is **durable object storage** (good for canonical datasets,
outputs, and sharing data across services). Daytona volumes are **durable shared file mounts**
optimized for **fast re-use inside sandboxes**.

Think of it like this:

- **InstantDB `$files`** is the source of truth and can be accessed by any service.
- **Daytona volumes** are a performance layer to avoid re-downloading the same files into sandboxes.

### Recommended pattern

1) **Persist canonical files** in InstantDB `$files`.
2) **On sandbox start**, check a manifest in the volume:
   - If present and hashes match, **use volume data**.
   - If not, **download from InstantDB** and refresh the volume + manifest.
3) **Write output back to InstantDB** when you need durable sharing or indexing.

### Example manifest layout

```
/home/daytona/.ekairos/datasets/{datasetId}/
  manifest.json
  raw/
  normalized/
  cache/
```

### Why both are needed

- InstantDB guarantees durability, queryability, and cross-service access.
- Volumes reduce cold-start and repeated downloads for sandbox workloads.

---

## Ephemeral sandboxes (Daytona)

Set `daytona.ephemeral = true` to auto-delete a sandbox after it stops.
Pair this with `autoStopIntervalMin` to avoid quota exhaustion from idle sandboxes.

```ts
const created = await sandboxes.createSandbox({
  provider: "daytona",
  daytona: {
    ephemeral: true,
    autoStopIntervalMin: 5,
  },
});
```

---

## Behavioral notes

### `createSandbox(config)`
- Creates an InstantDB record `sandbox_sandboxes[sandboxId]` with status `"creating"`.
- Provisions a provider sandbox (provider-specific).
- Updates the record to status `"active"` and stores `externalSandboxId`.

### `reconnectToSandbox(sandboxId)`
- Loads the record by internal `sandboxId`.
- Validates:
  - record exists
  - `externalSandboxId` exists
- Reconnects using the provider SDK/client (provider-specific).
- Returns `ok: false` if sandbox is not found/not running.
- If reconnection fails and the record was `"active"`, it may mark the record as `"shutdown"`.

### `runCommand(sandboxId, command, args?)`
- Durable-friendly command execution.
- Attempts to reconnect; if unavailable it may recreate the sandbox from the stored record configuration and retry.
- Returns a capped output payload suitable for storing in logs.

### `stopSandbox(sandboxId)`
- Attempts to reconnect and stop the provider sandbox.
- Marks the record as `"shutdown"` regardless (the provider sandbox may already be gone).

---

## Providers

### Daytona (current)

Environment variables:
- `DAYTONA_API_URL`
- `DAYTONA_API_KEY` or `DAYTONA_JWT_TOKEN + DAYTONA_ORGANIZATION_ID`
- `DAYTONA_TARGET` (optional)

Behavior notes:
- `externalSandboxId` maps to Daytona `sandbox.id`.
- Reconnect uses `daytona.get(id)` and starts if not running.
- File IO uses `sandbox.fs`.
- Command execution uses `sandbox.process.executeCommand`.

### Local Daytona OSS (Docker Desktop / Windows)

We keep the Daytona OSS repo **outside** this workspace to avoid nested repos.
Use the helper script in `./scripts/daytona-local.ps1` to clone and run the official
Docker Compose stack.

```powershell
# clone once (pin a ref for repeatability)
powershell -ExecutionPolicy Bypass -File .\scripts\daytona-local.ps1 init -Ref <tag-or-commit>

# start / stop
powershell -ExecutionPolicy Bypass -File .\scripts\daytona-local.ps1 up
powershell -ExecutionPolicy Bypass -File .\scripts\daytona-local.ps1 down
```

Defaults and overrides:
- Default clone path: `%USERPROFILE%\.ekairos\daytona-oss`
- Override with `DAYTONA_OSS_HOME`
- Pin a specific version with `DAYTONA_OSS_REF`

Environment variables for local usage:

```bash
SANDBOX_PROVIDER=daytona
DAYTONA_API_URL=http://localhost:3000/api
DAYTONA_API_KEY=... # create in the local Daytona dashboard (http://localhost:3000)
```

Optional: if you need proxy/preview URLs, Windows needs wildcard DNS for `*.proxy.localhost`.
You can run Daytona's `scripts/setup-proxy-dns.sh` inside WSL or use a local DNS tool.
This is not required for API-only usage.

### Vercel

Environment variables:
- `SANDBOX_VERCEL_TEAM_ID`
- `SANDBOX_VERCEL_PROJECT_ID`
- `SANDBOX_VERCEL_TOKEN`

Behavior notes:
- `externalSandboxId` maps to Vercel `sandbox.sandboxId`.
- Reconnect is done via `Sandbox.get(...)` using the stored `externalSandboxId`.

---

## Dev local (Daytona OSS en Docker Desktop)

### 1) Levantar Daytona local

Usa el helper para clonar el repo de Daytona (fuera del workspace) y levantar el stack:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\daytona-local.ps1 init
powershell -ExecutionPolicy Bypass -File .\scripts\daytona-local.ps1 up
```

Dashboard local: `http://localhost:3000`

Credenciales (dev):
- usuario: `dev@daytona.io`
- password: `password`

### 2) Crear API key manualmente

En el dashboard, ve a **API Keys** y crea una key. Luego configura tu app:

```bash
SANDBOX_PROVIDER=daytona
DAYTONA_API_URL=http://localhost:3000/api
DAYTONA_API_KEY=...tu_api_key_local...
```

Notas:
- Guarda la key localmente; **no la comitees**.
- Si necesitas proxy/preview en Windows, configura `*.proxy.localhost` (ver README de Daytona OSS).

---

## Development notes

- Prefer `runCommand(sandboxId, ...)` for provider-agnostic usage.
- Only `reconnect()` when you need direct provider SDK features.
- Avoid storing secrets in `params`.
- When using volumes, include a manifest/versioning strategy.

---

## Testing

A smoke test exists in:
- `packages/sandbox/src/tests/sandbox.temp-app.test.ts`

It:
- Creates a temporary Instant app via `instant-cli`.
- Pushes a minimal schema with `sandboxDomain`.
- Creates a sandbox (Daytona) and runs a simple command.

Run:
```bash
pnpm --filter @ekairos/sandbox test
```

---

## Roadmap

- Snapshot/image presets for faster cold-start.
- Volume GC policy.
- Preview proxy on custom domain.

