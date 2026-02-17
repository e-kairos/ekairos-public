# Thread Elements

`thread-elements` is a shadcn-compatible registry package for Ekairos.

It mirrors the AI SDK Elements catalog and exposes the same component set,
while adding first-class integration points for `@ekairos/thread` and
InstantDB domain runtime.

## Scope

- Registry API:
  - `GET /api/registry/registry.json`
  - `GET /api/registry/all.json`
  - `GET /api/registry/<component>.json`
- Docs:
  - `/docs`
  - `/docs/<component>`
- Thread domain integration:
  - `GET /api/thread/<threadKey>?orgId=<orgId>`
  - `useThread(...)` in `lib/use-thread.ts`
  - `useThreadDomain(...)` kept as compatibility alias

## Local Run

```bash
pnpm --filter thread-elements dev
```

Default port: `3040`

## Install Components via shadcn

Install all:

```bash
npx shadcn@latest add http://localhost:3040/api/registry/all.json
```

Install one:

```bash
npx shadcn@latest add http://localhost:3040/api/registry/message.json
```

## Runtime / Domain

Runtime is configured in `src/runtime.ts` and always provisions a temporary
InstantDB app for local previews using one of:

- `INSTANT_PERSONAL_ACCESS_TOKEN`
- `INSTANTDB_PERSONAL_ACCESS_TOKEN`
- `INSTANT_PLATFORM_ACCESS_TOKEN`

Put the token in:

- `packages/thread-elements/.env.local`

Example:

```bash
INSTANT_PERSONAL_ACCESS_TOKEN=your_token_here
```

The app domain composes `threadDomain` in `lib/domain.ts`.

## Runtime App Cookie

Registry preview routes persist the temporary app id in an httpOnly cookie:

- `ek_thread_elements_app_id`

Behavior:

- request uses cookie app id to resolve runtime first,
- if that app is no longer valid, runtime is invalidated and a new temp app is created,
- response writes the new app id back to the cookie.

## Element Parity Check

Use:

```bash
pnpm --filter thread-elements verify:elements
```

This verifies docs/components 1:1 parity inside this package.
