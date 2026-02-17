# @ekairos/story-react

React primitives for Ekairos **Story** UIs.

This package ships the core client hook: **`useStory()`**.

## Install

```bash
pnpm add @ekairos/story-react
```

## What `useStory` does

- **Timeline DX**: merges **persisted events** (InstantDB) + **optimistic user events** + **streaming assistant overlay**
- **Streaming**: consumes `ai` UIMessage stream (SSE) and updates the timeline live
- **Resumable streams (optional)**: stores `runId` + `chunkIndex` in `localStorage` and can resume with GET `?runId=...&startIndex=...`

## Usage

```tsx
"use client";

import { useStory } from "@ekairos/story-react";

export function MyStoryUI({ db, apiUrl, contextId }: { db: any; apiUrl: string; contextId?: string }) {
  const story = useStory(db, {
    apiUrl,
    initialContextId: contextId,
    enableResumableStreams: true,
    onContextUpdate: (id) => console.log("contextId:", id),
  });

  return (
    <div>
      <pre>status: {story.contextStatus}</pre>
      <button
        disabled={story.sendStatus === "submitting"}
        onClick={() => story.append({ parts: [{ type: "text", text: "Hola" }] })}
      >
        Send
      </button>
      <pre>{JSON.stringify(story.events, null, 2)}</pre>
    </div>
  );
}
```

## Default InstantDB queries (overrideable)

By default, `useStory` expects these namespaces:

- `context_contexts` (by `id`)
- `context_events` (by `context.id`, ordered by `createdAt: "asc"`)

If your schema differs, pass overrides (they MUST be hooks):

```ts
useStory(db, {
  apiUrl,
  context: (db, { contextId }) => {
    const res = db.useQuery(/* your query */);
    return { context: res.data?...., contextStatus: "open" };
  },
  events: (db, { contextId }) => {
    const res = db.useQuery(/* your query */);
    return { events: res.data?.... ?? [] };
  },
});
```

## API contract (server)

`useStory` sends:

- `POST apiUrl` with JSON `{ messages: [uiMessage], webSearch, reasoningLevel, contextId }`
- `GET apiUrl?runId=...&startIndex=...` (only if `enableResumableStreams` is enabled)

The server must respond with an `ai` SSE stream (`createUIMessageStreamResponse`).

