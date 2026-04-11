---
name: ekairos-domain-cli
description: Operate Ekairos apps through the @ekairos/domain CLI. Use when scaffolding a fresh app, provisioning a starter Next app, inspecting a running domain endpoint, executing domain actions, or querying InstaQL with JSON5, stdin, or files.
---

# ekairos-domain-cli

Use this skill to get from app path to useful terminal commands quickly.

## Start From Zero

Prefer the scaffold first:

```bash
npx @ekairos/domain create-app my-app --next
```

When you already have an Instant platform token, let the scaffold provision the app and write `.env.local`:

```bash
npx @ekairos/domain create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

For local monorepo iteration, point the scaffold to the workspace package:

```bash
npx @ekairos/domain create-app my-app --next --workspace /path/to/ekairos
```

## Operate A Running App

No login is required for local apps that accept admin queries through the endpoint:

```bash
npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty
npx @ekairos/domain seedDemo --baseUrl=http://localhost:3000 --admin --pretty
npx @ekairos/domain query "{ app_tasks: { comments: {} } }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Use JSON5 And Files

Prefer JSON5 over strict JSON. This keeps commands readable:

```bash
npx @ekairos/domain query "{ app_tasks: { $: { limit: 5 }, comments: {} } }" --baseUrl=http://localhost:3000 --admin
```

When shell quoting gets ugly, use a file or stdin:

```bash
npx @ekairos/domain query @query.json5 --baseUrl=http://localhost:3000 --admin
cat query.json5 | npx @ekairos/domain query - --baseUrl=http://localhost:3000 --admin
```

## Use User Contexts

Exactly one auth context should be active:

- `--admin`
- `--as-email <email>`
- `--as-guest`
- `--as-token <refresh-token>`

If the app uses a refresh token, store it once:

```bash
npx @ekairos/domain login http://localhost:3000 --refreshToken=<token> --appId=<app-id>
```

Then query again with no extra auth flag to use the client runtime path.

## Debug Shape

Add `--meta` when you need to know whether the result came from the local client runtime or the server route:

```bash
npx @ekairos/domain query "{ app_tasks: {} }" --meta
```

## Read Next

- Read `references/command-cookbook.md` for the most common command recipes.
