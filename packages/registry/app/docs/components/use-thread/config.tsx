"use client";

import React, { useMemo, useState } from "react";
import type { ThreadStreamChunk } from "@ekairos/thread";
import type { RegistryItem } from "@/lib/registry-types";

function UseThreadDemo() {
  const [contextId, setContextId] = useState<string | null>("ctx_demo_01");
  const [substateKey, setSubstateKey] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);

  const applyChunk = (chunk: ThreadStreamChunk) => {
    if (chunk.type === "data-context-id") {
      const nextId =
        typeof chunk.data?.contextId === "string"
          ? chunk.data.contextId
          : typeof chunk.id === "string"
            ? chunk.id
            : null;
      setContextId(nextId);
      setChunks((prev) => [`${chunk.type}: ${nextId ?? "null"}`, ...prev].slice(0, 6));
      return;
    }

    if (chunk.type === "data-context-substate") {
      const nextKey = typeof chunk.data?.key === "string" ? chunk.data.key : null;
      setSubstateKey(nextKey);
      setChunks((prev) => [`${chunk.type}: ${nextKey ?? "null"}`, ...prev].slice(0, 6));
      return;
    }

    setChunks((prev) => [`${chunk.type}`, ...prev].slice(0, 6));
  };

  const statusLabel = useMemo(() => {
    if (substateKey === "actions") {
      return "streaming-actions";
    }
    return "idle";
  }, [substateKey]);

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hook state</p>
        <div className="mt-3 grid gap-2 font-mono text-xs">
          <div>contextId: {contextId ?? "null"}</div>
          <div>substateKey: {substateKey ?? "null"}</div>
          <div>status: {statusLabel}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-id",
              data: { contextId: `ctx_demo_${Math.floor(Math.random() * 100)}` },
            })
          }
        >
          emit data-context-id
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-substate",
              data: { key: "actions" },
              transient: true,
            })
          }
        >
          emit data-context-substate(actions)
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-substate",
              data: { key: null },
              transient: true,
            })
          }
        >
          clear substate
        </button>
      </div>

      <div className="rounded-xl border bg-black/90 p-4 font-mono text-xs text-green-400">
        <p className="mb-2 text-muted-foreground">Chunk log</p>
        {chunks.length === 0 ? <div>&gt; no chunks yet</div> : null}
        {chunks.map((entry, index) => (
          <div key={`${entry}-${index}`}>&gt; {entry}</div>
        ))}
      </div>
    </div>
  );
}

export const useThreadRegistryItem: RegistryItem = {
  id: "use-thread",
  registryName: "use-thread",
  title: "useThread hook",
  subtitle:
    "Client hook from @ekairos/thread to load snapshots, process chunks, and keep context state synchronized.",
  category: "core",
  props: [
    {
      name: "threadKey",
      type: "string",
      default: "required",
      description: "Durable thread key used by the GET endpoint.",
    },
    {
      name: "orgId",
      type: "string",
      default: "-",
      description: "Tenant/runtime org id forwarded as query parameter.",
    },
    {
      name: "endpoint",
      type: "string",
      default: "'/api/thread'",
      description: "Base endpoint used by the hook for snapshot fetches.",
    },
    {
      name: "ensure",
      type: "boolean",
      default: "false",
      description: "When true, endpoint can ensure thread/context existence before read.",
    },
    {
      name: "refreshMs",
      type: "number",
      default: "-",
      description: "Optional polling interval for background refresh.",
    },
  ],
  code: `"use client"

import { useThread } from "@ekairos/thread"

export function ThreadStatePanel() {
  const {
    data,
    isLoading,
    error,
    contextId,
    substateKey,
    applyChunk,
    refresh,
  } = useThread({
    threadKey: "support.agent.session.42",
    orgId: "org_123",
    endpoint: "/api/thread",
    ensure: true,
    refreshMs: 5000,
  })

  return (
    <div>
      <p>contextId: {contextId}</p>
      <p>substateKey: {substateKey ?? "none"}</p>
      <button onClick={refresh}>refresh</button>
    </div>
  )
}
`,
  render: () => <UseThreadDemo />,
};
