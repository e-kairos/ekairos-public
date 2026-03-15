# Ekairos Context Specification

`@ekairos/events` defines a context-first durable execution model.

## Core entities

- `context`
- `execution`
- `step`
- `part`
- `item`

## Persistence

Canonical persistence uses:

- `event_contexts`
- `event_executions`
- `event_steps`
- `event_parts`
- `event_items`

Tracing uses:

- `event_trace_events`
- `event_trace_runs`
- `event_trace_spans`

## Status model

- Context: `open_idle | open_streaming | closed`
- Execution: `executing | completed | failed`
- Step: `running | completed | failed`
- Item: `stored | pending | completed`

## Stream model

The runtime currently exposes context stream helpers, but the durable truth remains the persisted entities above. Clients should treat context state as primary and stream output as live UX.
