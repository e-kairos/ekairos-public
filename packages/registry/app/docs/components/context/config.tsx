"use client";

import React, { useMemo, useState } from "react";
import type { RegistryItem } from "@/lib/registry-types";

type TimelineEvent = {
  entity: "context" | "execution" | "item" | "step" | "chunk";
  text: string;
};

const scriptedTimeline: TimelineEvent[] = [
  { entity: "context", text: "context.created -> open_idle" },
  { entity: "execution", text: "execution.created -> executing" },
  { entity: "step", text: "step.created -> running" },
  { entity: "item", text: "item.created (reaction) -> stored" },
  { entity: "chunk", text: "chunk.emitted -> data-context-id" },
  { entity: "step", text: "step.status.changed running -> completed" },
  { entity: "execution", text: "execution.status.changed executing -> completed" },
  { entity: "context", text: "context.status_changed -> closed" },
];

const entityStyles: Record<TimelineEvent["entity"], string> = {
  context: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  execution: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  item: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  step: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  chunk: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300",
};

const CONTEXT_TRANSITIONS = [
  { from: "open_idle", to: "open_streaming" },
  { from: "open_streaming", to: "open_idle" },
  { from: "open_idle", to: "closed" },
  { from: "open_streaming", to: "closed" },
  { from: "closed", to: "open_idle" },
] as const;

const EXECUTION_TRANSITIONS = [
  { from: "executing", to: "completed" },
  { from: "executing", to: "failed" },
] as const;

const STEP_TRANSITIONS = [
  { from: "running", to: "completed" },
  { from: "running", to: "failed" },
] as const;

const ITEM_TRANSITIONS = [
  { from: "stored", to: "pending" },
  { from: "stored", to: "completed" },
  { from: "pending", to: "completed" },
] as const;

const CONTEXT_STREAM_CHUNK_TYPES = [
  "chunk.start",
  "chunk.start_step",
  "chunk.finish_step",
  "chunk.finish",
  "chunk.text_start",
  "chunk.text_delta",
  "chunk.text_end",
  "chunk.reasoning_start",
  "chunk.reasoning_delta",
  "chunk.reasoning_end",
  "chunk.action_input_start",
  "chunk.action_input_delta",
  "chunk.action_input_available",
  "chunk.action_output_available",
  "chunk.action_output_error",
  "chunk.source_url",
  "chunk.source_document",
  "chunk.file",
  "chunk.message_metadata",
  "chunk.response_metadata",
  "chunk.error",
  "chunk.unknown",
] as const;

const transitionGroups = [
  { label: "context", list: CONTEXT_TRANSITIONS },
  { label: "execution", list: EXECUTION_TRANSITIONS },
  { label: "step", list: STEP_TRANSITIONS },
  { label: "item", list: ITEM_TRANSITIONS },
];

function ContextTimelineDemo() {
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
            {CONTEXT_STREAM_CHUNK_TYPES.map((chunkType) => (
              <div key={chunkType}>{chunkType}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const contextRegistryItem: RegistryItem = {
  id: "context",
  registryName: "context",
  title: "Context",
  subtitle:
    "Conversation container plus lifecycle contract reference for context/execution/item/step/part/chunk.",
  category: "compound",
  props: [
    {
      name: "children",
      type: "ReactNode",
      default: "-",
      description: "Context body content (usually message/event rows).",
    },
    {
      name: "className",
      type: "string",
      default: "-",
      description: "Optional className forwarded to the root conversation container.",
    },
  ],
  code: `import { Context, ContextContent, ContextScrollButton } from "@/components/ekairos/context"
import { createContext, createScriptedReactor } from "@ekairos/events"

const reactor = createScriptedReactor({
  steps: [
    {
      assistantEvent: {
        content: { parts: [{ type: "text", text: "Deterministic response" }] },
      },
        actionRequests: [],
      messagesForModel: [],
    },
  ],
  repeatLast: true,
})

const demoContext = createContext<{ orgId: string }>("demo.context")
  .context((stored, env) => ({ ...stored.content, orgId: env.orgId }))
  .narrative(() => "You are deterministic")
  .actions(() => ({}))
  .reactor(reactor)
  .build()

export function ContextView() {
  return (
    <Context className="h-[420px] rounded-xl border">
      <ContextContent>{/* events */}</ContextContent>
      <ContextScrollButton />
    </Context>
  )
}
`,
  render: () => <ContextTimelineDemo />,
};
