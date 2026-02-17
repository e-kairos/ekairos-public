# Main-Centric Release and Publish

This repository uses a main-centric release flow:

- `release:*` commands create a new version commit and push to `main`.
- `publish:*` commands execute the full publish pipeline for a channel.
- CI on `main` calls a single `publish:*` command based on the version suffix.

## 1. Release (version + commit + push)

Primary command:

```bash
pnpm release -- --channel <beta|rc|next|latest>
```

Short aliases:

```bash
pnpm release:beta
pnpm release:rc
pnpm release:next
pnpm release:latest
```

What release does:

1. bumps root version
2. runs `prepare-publish`
3. updates lockfile (`pnpm install --lockfile-only --link-workspace-packages`)
4. runs `release-check`
5. commits release manifests
6. pushes to current branch (expected: `main`)

## 2. Publish (single command per channel)

All publish steps are centralized in `publish:*`.

Channel commands:

```bash
pnpm publish:beta
pnpm publish:rc
pnpm publish:next
pnpm publish:latest
```

Dry-run variants:

```bash
pnpm publish:dry-run:beta
pnpm publish:dry-run:rc
pnpm publish:dry-run:next
pnpm publish:dry-run:latest
```

What each `publish:*` does:

1. `build:publish-packages`
2. `prepare-publish`
3. `release-check --tag <channel>`
4. npm auth check
5. `publish-release --tag <channel>`

## 3. CI behavior

Workflow: `.github/workflows/release.yml`

On push to `main`:

1. detect if root `package.json` changed
2. infer channel from version:
   - `x.y.z-beta.n` -> `beta`
   - `x.y.z-rc.n` -> `rc`
   - `x.y.z-next.n` -> `next`
   - `x.y.z` -> `latest`
3. run one command:
   - `pnpm run publish:<channel>`

## 4. Required secret

Set GitHub Actions secret:

- `NPM_TOKEN` (granular token with publish permissions for `@ekairos/*`, `ekairos`, and `ekairos-cli`)

## 5. TODO

- Migrate from `NPM_TOKEN` to npm Trusted Publishing (OIDC) and remove token-based auth.
