# Context Runtime Notes

This package is being normalized around `context` as the primary aggregate.

Current implementation goals:

- keep the public surface context-first
- keep persistence centered on `event_*` entities
- avoid legacy `context` naming in new code and docs
- preserve provider-specific external identifiers only where upstream contracts require them
