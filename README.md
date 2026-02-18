# Ekairos Workspace

Public monorepo for Ekairos npm packages.

## What is here

- Reusable libraries used by Ekairos Core and client platforms.
- Publishable packages under `packages/*`.
- Shared build, release, and CI scripts.

## Main packages

- `@ekairos/domain`
- `@ekairos/sandbox`
- `@ekairos/thread`
- `@ekairos/dataset`
- `@ekairos/structure`
- `@ekairos/story-react`
- `@ekairos/openai-reactor`
- `@ekairos/testing`
- `ekairos` / `ekairos-cli`

## Requirements

- Node.js 20+
- pnpm 10+

## Local development

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm build
pnpm typecheck
pnpm test
```

## Publishing model

- `main` publishes stable releases to `latest`.
- Any non-main branch publishes branch-scoped betas to `beta`.
- Publish runs only after required checks pass.
- Root `package.json` version must always be stable semver (`x.y.z`) on all branches.
- CI is the only place that generates prerelease suffixes (`-beta.<branch>.0`).
- Versions are computed in CI from `package.json` base version:
  - `main`: tries exact base core first (example `1.22.0`), then increments patch if that exact version already exists.
  - branch: publishes `x.y.z-beta.<branch>.0`, with patch selected to stay ahead of both current `latest` and `beta` in the same major/minor lane.

## Release commands

```bash
# Local required checks
pnpm run release:required-checks

# Local publishable build
pnpm run build:publish-packages

# Optional local release consistency check
node scripts/release-check.mjs --tag latest
```

## Minor stable release (recommended)

1. Set root version base to the target minor in `package.json` (example `1.22.0`).
2. Run local checks:

```bash
pnpm run release:required-checks
pnpm run build:publish-packages
```

3. Push to `main`.
4. CI publishes stable `latest` (`1.22.0` if not already taken).

## Branch beta behavior

- Never commit `-beta`, `-rc`, or `-next` in version files.
- Push branch with stable base (for example `1.22.0`).
- CI publishes branch beta automatically and advances patch when needed.
- Example:
  - `latest = 1.1.1`
  - branch base = `1.1.1`
  - published branch beta starts at `1.1.2-beta.<branch>.0`

## CI requirements

Repository secret required:

- `NPM_TOKEN` (npm automation token with publish permissions)

## License

Apache-2.0
