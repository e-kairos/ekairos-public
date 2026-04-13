# @ekairos/sandbox

Provider-agnostic sandbox service with durable sandbox ids stored in InstantDB.

## What it does

- creates sandboxes and persists them in `sandbox_sandboxes`
- reconnects by durable `sandboxId`
- runs commands
- reads and writes files
- supports multiple providers behind one API

## Main APIs

- `sandboxDomain`
- `SandboxService`
- `createVercelSandbox(...)`
- `runCommandInSandbox(...)`

## Providers

- `vercel`
- `daytona`
- `sprites`

Provider selection:

1. `config.provider`
2. `SANDBOX_PROVIDER`
3. default provider

## Quick example

```ts
const service = new SandboxService(db);

const created = await service.createSandbox({
  provider: "vercel",
  runtime: "node22",
});

if (!created.ok) throw new Error(created.error);

const run = await service.runCommand(created.data.sandboxId, "node", ["-v"]);
```

## Vercel cost profiles

Vercel Sandbox is metered by active CPU, provisioned memory, creations, data transfer, and storage.
`SandboxService` keeps the default Vercel profile small:

- `ephemeral` profile: 1 vCPU, 5 minute timeout, no persistence.
- `coding-agent` profile: 2 vCPUs, 20 minute timeout, persistent filesystem, 7 day snapshot expiration.
- `stopSandbox` deletes ephemeral Vercel sandboxes, but only stops persistent coding-agent sandboxes.

The `coding-agent` profile is selected automatically when `purpose` mentions `codex` or `agent`, or explicitly:

```ts
const created = await service.createSandbox({
  provider: "vercel",
  purpose: "codex-reactor",
  runtime: "node22",
  ports: [3000],
  vercel: {
    profile: "coding-agent",
    name: "ekairos-codex-workspace",
    reuse: true,
    persistent: true,
    scope: "ekairos-dev",
    cwd: "C:/ek",
  },
});
```

When `vercel.name`, `persistent`, and `reuse` are enabled, Ekairos first tries to resume the named sandbox before creating a new one. This reduces repeated installs, network transfer, and creation churn for coding-agent workspaces.

`createCheckpoint` and `listCheckpoints` use Vercel snapshots for Vercel sandboxes. Creating a Vercel snapshot stops the current VM session; the next command resumes the named sandbox from provider state.

Useful env overrides:

- `SANDBOX_PROVIDER=vercel`
- `SANDBOX_VERCEL_PROFILE=coding-agent`
- `SANDBOX_VERCEL_NAME=ekairos-codex-workspace`
- `SANDBOX_VERCEL_REUSE=true`
- `SANDBOX_VERCEL_PERSISTENT=true`
- `SANDBOX_VERCEL_DELETE_ON_STOP=false`
- `SANDBOX_VERCEL_TIMEOUT_MS=1200000`
- `SANDBOX_VERCEL_VCPUS=2`

## Important ids

- `sandboxId`: durable InstantDB record id
- `externalSandboxId`: provider-native sandbox id

## Tests

```bash
pnpm --filter @ekairos/sandbox test
```
