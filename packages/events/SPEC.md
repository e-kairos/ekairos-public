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

### Canonical Output Contract

`event_parts` is the canonical persisted representation of produced content.

`event_items` still exists as the stable envelope for input/output history, but for output items:

- `event_items.content.parts` is deprecated as a replay source
- `event_parts` is the authoritative model for step inspection and model reconstruction

### Event Part Semantics

`event_parts.part` must follow a strict semantic contract.

Top-level `part.type` values:

- `content`
- `reasoning`
- `source`
- `tool-call`
- `tool-result`

Every part carries `content: []`, where each entry is one of:

- `text`
- `file`
- `json`
- `source-url`
- `source-document`

Tool execution is modeled explicitly:

- `tool-call`: the requested invocation plus canonicalized input content
- `tool-result`: the settled outcome plus canonicalized output content

`tool-result` covers both success and failure via `state`:

- `output-available`
- `output-error`

There is no separate canonical `tool-error` part in persistence. If an external protocol requires a
`tool-error` message, it must be projected from `tool-result` during adaptation.

### Metadata Rule

Provider/model/runtime-specific data must be encapsulated under `metadata`.

Examples:

- provider item ids
- provider-executed flags
- model response ids
- transport-specific chunk references

These values must not leak into first-class semantic fields like `type`, `toolName`, `toolCallId`,
or the `content` entry shapes.

### Replay Rule

The replay pipeline must reconstruct model messages from canonical `event_parts` for output items.

Required projection:

- `content` / `reasoning` / `source` -> assistant or user content
- `tool-call` -> assistant tool call
- `tool-result` -> tool message result/error

This rule exists so multipart tool outputs, including image artifacts, survive replay without depending
on the deprecated `event_items.content.parts` mirror.

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
