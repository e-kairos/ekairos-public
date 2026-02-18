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

- `main` is the release branch.
- Every push to `main` triggers CI beta publishing.
- CI computes the next semantic beta version (`x.y.z-beta.0`) and publishes with provenance.
- Publish is gated by required checks (`release-required-checks`) before npm steps run.
- Pushes to feature branches also run `release-required-checks` (no publish outside `main`).

Manual channel publishing (maintainers):

```bash
# 1) local preflight
pnpm run release:required-checks

# 2) branch validation (CI, no publish)
# push your branch or open a PR to main

# 3) publish on main (after merge)
pnpm run publish:beta
pnpm run publish:rc
pnpm run publish:latest
pnpm run publish:next
```

## CI requirements

Repository secret required:

- `NPM_TOKEN` (npm automation token with publish permissions)

## License

Apache-2.0
