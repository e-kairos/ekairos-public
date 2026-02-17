---
name: ekairos.domain.query
short_description: Run InstaQL against an Ekairos domain endpoint.
tags:
  - ekairos
  - domain
  - instaql
  - query
---

# ekairos.domain.query

Query an Ekairos domain by calling the app's well-known domain endpoint. This is the
bridge skill that lets an agent with a sandbox access domain data without direct DB
credentials.

## What it does
- Sends a POST request to `/.well-known/ekairos/v1/domain`.
- Passes `org_id` + InstaQL query.
- Returns the JSON response (includes `data` + `truncated` when applicable).

## Inputs
- `org_id` (string): Clerk organization id. If omitted, uses `EKAIROS_ORG_ID`.
- `query` (object|string): InstaQL query object or JSON string.
- `base_url` (string, optional): Override `EKAIROS_DOMAIN_BASE_URL`.

## Environment
- `EKAIROS_DOMAIN_BASE_URL` (required unless `base_url` is passed)
- `EKAIROS_ORG_ID` (optional fallback for `org_id`)
- `EKAIROS_DOMAIN_OIDC_TOKEN` or `EKAIROS_DOMAIN_TOKEN` (optional; used for auth)

## Output
- On success: JSON from the domain endpoint (typically `{ ok, data, truncated }`).
- On error: `{ ok: false, error, status? }`.

## Examples

### Minimal (JSON args)

```
{"org_id":"org_123","query":{"requisitions":{"$":{"limit":2}}}}
```

### Using env defaults

```
{"query":{"tenders":{"$":{"limit":1}}}}
```

## Notes
- This skill assumes the app exposes the standard Ekairos domain endpoint.
- If auth is required, provide a valid OIDC token or static domain token.
- The endpoint performs query truncation to keep responses small.
