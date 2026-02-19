"use client";

import React, { useMemo, useState } from "react";
import {
  THREAD_CONTEXT_TRANSITIONS,
  THREAD_EXECUTION_TRANSITIONS,
  THREAD_ITEM_TRANSITIONS,
  THREAD_STEP_TRANSITIONS,
  THREAD_STREAM_CHUNK_TYPES,
  THREAD_THREAD_TRANSITIONS,
} from "@ekairos/thread";
import type { RegistryItem } from "@/lib/registry-types";

type TimelineEvent = {
  entity: "context" | "thread" | "execution" | "item" | "step" | "chunk";
  text: string;
};

const scriptedTimeline: TimelineEvent[] = [
  { entity: "context", text: "context.created -> open" },
  { entity: "thread", text: "thread.created -> open" },
  { entity: "execution", text: "execution.created -> executing" },
  { entity: "step", text: "step.created -> running" },
  { entity: "item", text: "item.created (reaction) -> stored" },
  { entity: "chunk", text: "chunk.emitted -> data-context-id" },
  { entity: "chunk", text: "chunk.emitted -> data-context-substate" },
  { entity: "step", text: "step.status.changed running -> completed" },
  { entity: "execution", text: "execution.status.changed executing -> completed" },
  { entity: "thread", text: "thread.finished -> completed" },
];

const entityStyles: Record<TimelineEvent["entity"], string> = {
  context: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  thread: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  execution: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  item: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  step: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  chunk: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300",
};

const transitionGroups = [
  { label: "thread", list: THREAD_THREAD_TRANSITIONS },
  { label: "context", list: THREAD_CONTEXT_TRANSITIONS },
  { label: "execution", list: THREAD_EXECUTION_TRANSITIONS },
  { label: "step", list: THREAD_STEP_TRANSITIONS },
  { label: "item", list: THREAD_ITEM_TRANSITIONS },
];

function ThreadTimelineDemo() {
  const [cursor, setCursor] = useState(4);

  const visibleEvents = useMemo(
    () => scriptedTimeline.slice(0, cursor),
    [cursor],
  );

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Scripted turn timeline
          </p>
          <button
            type="button"
            onClick={() =>
              setCursor((value) =>
                value >= scriptedTimeline.length ? 1 : value + 1,
              )
            }
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          >
            advance
          </button>
        </div>

        <div className="space-y-2">
          {visibleEvents.map((event, index) => (
            <div
              key={`${event.text}-${index}`}
              className={`rounded-md border px-3 py-2 text-sm ${entityStyles[event.entity]}`}
            >
              {event.text}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-background p-4">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Allowed transitions
          </p>
          <div className="space-y-2 font-mono text-xs">
            {transitionGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-1 text-muted-foreground">{group.label}</p>
                {group.list.map((transition) => (
                  <div key={`${group.label}:${transition.from}:${transition.to}`}>
                    {transition.from} -&gt; {transition.to}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-background p-4">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Stream chunk types
          </p>
          <div className="space-y-1 font-mono text-xs">
            {THREAD_STREAM_CHUNK_TYPES.map((chunkType) => (
              <div key={chunkType}>{chunkType}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const threadRegistryItem: RegistryItem = {
  id: "thread",
  registryName: "thread",
  title: "Thread",
  subtitle:
    "Conversation container plus lifecycle contract reference for context/thread/item/step/part/chunk.",
  category: "compound",
  props: [
    {
      name: "children",
      type: "ReactNode",
      default: "-",
      description: "Thread body content (usually message/event rows).",
    },
    {
      name: "className",
      type: "string",
      default: "-",
      description: "Optional className forwarded to the root conversation container.",
    },
  ],
  code: `import { Thread, ThreadContent, ThreadScrollButton } from "@/components/ekairos/thread"
import { createThread, createScriptedReactor } from "@ekairos/thread"

const reactor = createScriptedReactor({
  steps: [
    {
      assistantEvent: {
        content: { parts: [{ type: "text", text: "Deterministic response" }] },
      },
      toolCalls: [],
      messagesForModel: [],
    },
  ],
  repeatLast: true,
})

const demoThread = createThread<{ orgId: string }>("demo.thread")
  .context((stored, env) => ({ ...stored.content, orgId: env.orgId }))
  .narrative(() => "You are deterministic")
  .actions(() => ({}))
  .reactor(reactor)
  .build()

export function ThreadView() {
  return (
    <Thread className="h-[420px] rounded-xl border">
      <ThreadContent>{/* events */}</ThreadContent>
      <ThreadScrollButton />
    </Thread>
  )
}
`,
  render: () => <ThreadTimelineDemo />,
};
