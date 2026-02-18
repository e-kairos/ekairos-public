# Ekairos Workspace Release Guide

This repository publishes npm packages through GitHub Actions.

## Current release behavior

- Push to `main` -> stable publish to `latest`.
- Push to any other branch -> beta publish to `beta` with branch suffix.
- Required checks run before publish (`release-required-checks` job).
- Root `package.json` must be stable semver (`x.y.z`) on all branches.
- Prerelease suffixes are CI-generated only (never committed manually).

## Version resolution

CI computes the publish version from root `package.json`:

- `main`
  - Uses the base core version first (`x.y.z`).
  - If that exact version already exists in npm, patch is incremented (`x.y.(z+1)`).
- non-main branch
  - Uses `x.y.z-beta.<branch>.0`.
  - Chooses patch so it stays ahead of both `latest` and `beta` in the same major/minor lane.
  - Example: if `latest` is `1.1.1` and base is `1.1.1`, branch beta starts at `1.1.2-beta.<branch>.0`.

This lets you force a minor stable release by setting the base version to `x.(y+1).0`.

## Standard minor stable release flow

1. Set `package.json` root version to target minor, for example `1.22.0`.
2. Run local checks:

```bash
pnpm run release:required-checks
pnpm run build:publish-packages
```

3. Commit and push to `main`.
4. Wait for workflow `Publish Packages` to finish green.
5. Verify npm:

```bash
npm view @ekairos/domain@latest version
```

## Fast verification commands

```bash
# Workflow status
gh run list -R e-kairos/ekairos --limit 5

# Failed logs for a run
gh run view <run-id> -R e-kairos/ekairos --log-failed

# NPM verification
npm view @ekairos/domain@latest version
npm view @ekairos/domain@beta version
```
