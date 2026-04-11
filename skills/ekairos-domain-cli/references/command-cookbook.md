# Command Cookbook

## Scaffold

```bash
npx @ekairos/domain create-app my-app --next
npx @ekairos/domain create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

## Inspect

```bash
npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty
```

## Run An Action

```bash
npx @ekairos/domain createTask "{ title: 'Ship CLI onboarding' }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Query Nested Data

```bash
npx @ekairos/domain query "{ app_tasks: { comments: {} } }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Query From File

`query.json5`

```json5
{
  app_tasks: {
    $: { limit: 10, order: { createdAt: "desc" } },
    comments: {}
  }
}
```

Run:

```bash
npx @ekairos/domain query @query.json5 --baseUrl=http://localhost:3000 --admin
```

## Switch To User Scope

```bash
npx @ekairos/domain login http://localhost:3000 --refreshToken=<token> --appId=<app-id>
npx @ekairos/domain query "{ app_tasks: {} }" --meta
```
