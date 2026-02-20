"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageList } from "@/components/ekairos/agent/ui/message-list";
import { useScriptedCodexThread } from "@/components/ekairos/agent/mocks/use-scripted-codex-thread";

const VISITOR_STORAGE_KEY = "ekairos.registry.demo.visitorId";
const APP_STORAGE_KEY = "ekairos.registry.demo.appId";

type TenantPayload = {
  appId: string;
  title: string;
  visitorId: string;
  created: boolean;
  recovered: boolean;
};

type BootstrapPayload = {
  appId: string;
  title: string;
  seeded: boolean;
  counts: {
    threads: number;
    contexts: number;
    items: number;
  };
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type StreamTimelineRow = {
  key: string;
  order: number;
  createdAt: string;
  eventId: string;
  eventType: string;
  eventStatus: string;
  partType: string;
  partState: string;
  phase: string;
  label: string;
};

type SyncLogEntry = {
  id: string;
  at: string;
  level: "info" | "success" | "warn";
  source: "stream" | "instant";
  message: string;
};

type TenantEntitiesSnapshot = {
  appId: string;
  threadId: string | null;
  contextId: string | null;
  thread: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  counts: {
    executions: number;
    items: number;
    steps: number;
    parts: number;
  };
  entities: {
    executions: Array<Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    steps: Array<Record<string, unknown>>;
    parts: Array<Record<string, unknown>>;
  };
};

function createVisitorId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeId(prefix: string): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return `${prefix}:${generated}`;
  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatClock(isoLike: string): string {
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return "--:--:--";
  return parsed.toISOString().slice(11, 23);
}

function rowId(row: Record<string, unknown>): string {
  return pickString(row.id);
}

function nowIso(): string {
  return new Date().toISOString();
}

export default function DemoPage() {
  const [tenant, setTenant] = useState<TenantPayload | null>(null);
  const [statusText, setStatusText] = useState("Initializing tenant...");
  const [provisioning, setProvisioning] = useState(true);
  const [destroying, setDestroying] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [syncingEntities, setSyncingEntities] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [entities, setEntities] = useState<TenantEntitiesSnapshot | null>(null);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const streamViewportRef = useRef<HTMLDivElement | null>(null);
  const syncViewportRef = useRef<HTMLDivElement | null>(null);
  const previousEntitiesRef = useRef<TenantEntitiesSnapshot | null>(null);

  const persistReplayAction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!tenant?.appId) return;
      await fetch("/api/demo/thread/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: tenant.appId,
          ...payload,
        }),
      });
    },
    [tenant?.appId],
  );

  const fetchEntities = useCallback(async () => {
    if (!tenant?.appId) {
      setSyncingEntities(false);
      setEntities(null);
      return;
    }
    setSyncingEntities(true);
    try {
      const query = new URLSearchParams({ appId: tenant.appId });
      const response = await fetch(`/api/demo/tenant/entities?${query.toString()}`);
      const payload = (await response.json()) as ApiResponse<TenantEntitiesSnapshot>;
      if (!response.ok || !payload.ok || !payload.data) return;
      setEntities(payload.data);
    } finally {
      setSyncingEntities(false);
    }
  }, [tenant?.appId]);

  const thread = useScriptedCodexThread({
    onRunStart: async ({ runId }) => {
      await persistReplayAction({
        action: "start",
        runId,
      });
      await fetchEntities();
    },
    onEvent: async ({ runId, sequence, event }) => {
      await persistReplayAction({
        action: "event",
        runId,
        sequence,
        event,
      });
      await fetchEntities();
    },
    onRunFinish: async ({ runId }) => {
      await persistReplayAction({
        action: "finish",
        runId,
      });
      await fetchEntities();
    },
    onReset: async () => {
      await persistReplayAction({
        action: "reset",
      });
      await fetchEntities();
    },
  });
  const [prompt, setPrompt] = useState(
    "Inspect README.md and reply with a short summary of what it contains.",
  );
  const isRunning =
    thread.contextStatus === "streaming" || thread.sendStatus === "submitting";

  const streamRows = useMemo<StreamTimelineRow[]>(() => {
    const rows: StreamTimelineRow[] = [];
    let order = 0;

    for (const event of thread.events) {
      const parts = Array.isArray(event.content?.parts) ? event.content.parts : [];
      if (parts.length === 0) {
        rows.push({
          key: `${event.id}:event`,
          order,
          createdAt: pickString(event.createdAt) || nowIso(),
          eventId: event.id,
          eventType: event.type,
          eventStatus: pickString(event.status),
          partType: "none",
          partState: "none",
          phase: "",
          label: "",
        });
        order += 1;
        continue;
      }

      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const rawPart = parts[partIndex] as Record<string, unknown> | null;
        const part = rawPart ?? {};
        const metadata =
          (part.metadata as Record<string, unknown> | undefined) ?? {};
        const input = (part.input as Record<string, unknown> | undefined) ?? {};
        const output = (part.output as Record<string, unknown> | undefined) ?? {};
        const label =
          pickString(metadata.label) ||
          pickString(output.label) ||
          pickString(input.label) ||
          pickString(part.text);
        const phase =
          pickString(metadata.phase) ||
          pickString(output.phase) ||
          pickString(input.phase);

        rows.push({
          key: `${event.id}:${partIndex}:${order}`,
          order,
          createdAt: pickString(event.createdAt) || nowIso(),
          eventId: event.id,
          eventType: event.type,
          eventStatus: pickString(event.status),
          partType: pickString(part.type) || "unknown",
          partState: pickString(part.state) || "none",
          phase,
          label,
        });
        order += 1;
      }
    }

    return rows;
  }, [thread.events]);

  const pollIntervalRef = useRef<number | null>(null);

  const loadTenant = useCallback(async () => {
    if (typeof window === "undefined") return;

    const storedVisitorId =
      window.localStorage.getItem(VISITOR_STORAGE_KEY) ?? createVisitorId();
    const storedAppId = window.localStorage.getItem(APP_STORAGE_KEY);
    window.localStorage.setItem(VISITOR_STORAGE_KEY, storedVisitorId);

    setProvisioning(true);
    setStatusText("Provisioning Instant app for this visitor...");

    const response = await fetch("/api/demo/tenant/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: storedVisitorId,
        appId: storedAppId,
      }),
    });

    const payload = (await response.json()) as ApiResponse<TenantPayload>;
    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error || "Failed to initialize demo tenant.");
    }

    window.localStorage.setItem(APP_STORAGE_KEY, payload.data.appId);
    setTenant(payload.data);
    setStatusText(
      payload.data.created
        ? "Tenant ready (new app created)."
        : "Tenant ready (existing app recovered).",
    );
  }, []);

  const bootstrapTenant = useCallback(async () => {
    if (!tenant?.appId) return;
    setBootstrapping(true);
    try {
      const response = await fetch("/api/demo/tenant/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: tenant.appId }),
      });
      const payload = (await response.json()) as ApiResponse<BootstrapPayload>;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Bootstrap failed.");
      }
      setBootstrap(payload.data);
      setStatusText(
        payload.data.seeded
          ? "Runtime bootstrap completed and seeded."
          : "Runtime bootstrap completed (existing data reused).",
      );
      await fetchEntities();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Runtime bootstrap failed: ${message}`);
    } finally {
      setBootstrapping(false);
    }
  }, [fetchEntities, tenant?.appId]);

  const destroyTenant = useCallback(async () => {
    if (!tenant?.appId || typeof window === "undefined") return;
    setDestroying(true);
    try {
      await fetch("/api/demo/tenant/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: tenant.appId }),
      });
      window.localStorage.removeItem(APP_STORAGE_KEY);
      setTenant(null);
      setBootstrap(null);
      setEntities(null);
      setStatusText("Tenant destroyed. Re-provisioning...");
      await loadTenant();
    } finally {
      setDestroying(false);
    }
  }, [loadTenant, tenant?.appId]);

  useEffect(() => {
    loadTenant()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatusText(`Tenant initialization failed: ${message}`);
      })
      .finally(() => {
        setProvisioning(false);
      });
  }, [loadTenant]);

  useEffect(() => {
    if (!tenant?.appId) return;
    void fetchEntities();
  }, [fetchEntities, tenant?.appId]);

  useEffect(() => {
    if (!tenant?.visitorId || !tenant?.appId) return;

    const poll = async () => {
      const query = new URLSearchParams({
        visitorId: tenant.visitorId,
        appId: tenant.appId,
      });
      const response = await fetch(`/api/demo/tenant/status?${query.toString()}`);
      const payload = (await response.json()) as ApiResponse<{
        exists: boolean;
        reason: string;
      }>;

      if (!response.ok || !payload.ok || !payload.data) return;
      if (payload.data.exists) return;

      setStatusText("Tenant app disappeared. Re-provisioning...");
      await loadTenant();
    };

    pollIntervalRef.current = window.setInterval(() => {
      void poll();
    }, 20000);

    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [loadTenant, tenant?.appId, tenant?.visitorId]);

  useEffect(() => {
    if (!tenant?.appId) return;
    const intervalMs =
      thread.contextStatus === "streaming" || thread.sendStatus === "submitting"
        ? 1000
        : 2500;
    const poll = window.setInterval(() => {
      void fetchEntities();
    }, intervalMs);
    return () => {
      window.clearInterval(poll);
    };
  }, [fetchEntities, tenant?.appId, thread.contextStatus, thread.sendStatus]);

  useEffect(() => {
    previousEntitiesRef.current = null;
    setSyncLog([]);
  }, [tenant?.appId]);

  useEffect(() => {
    if (!entities) return;

    const nextEntries: SyncLogEntry[] = [];
    const prev = previousEntitiesRef.current;
    const push = (
      level: SyncLogEntry["level"],
      source: SyncLogEntry["source"],
      message: string,
      at?: string,
    ) => {
      nextEntries.push({
        id: makeId("sync-log"),
        at: at ?? nowIso(),
        level,
        source,
        message,
      });
    };

    if (!prev) {
      push(
        "info",
        "instant",
        `snapshot loaded app=${entities.appId} executions=${entities.counts.executions} items=${entities.counts.items} steps=${entities.counts.steps} parts=${entities.counts.parts}`,
      );
      if (entities.thread) {
        push(
          "info",
          "instant",
          `thread id=${pickString(entities.thread.id)} status=${pickString(entities.thread.status)}`,
          pickString(entities.thread.updatedAt) || nowIso(),
        );
      }
      if (entities.context) {
        push(
          "info",
          "instant",
          `context id=${pickString(entities.context.id)} status=${pickString(entities.context.status)}`,
          pickString(entities.context.updatedAt) || nowIso(),
        );
      }
    } else {
      if (prev.counts.executions !== entities.counts.executions) {
        push(
          "success",
          "instant",
          `executions ${prev.counts.executions} -> ${entities.counts.executions}`,
        );
      }
      if (prev.counts.items !== entities.counts.items) {
        push("success", "instant", `items ${prev.counts.items} -> ${entities.counts.items}`);
      }
      if (prev.counts.steps !== entities.counts.steps) {
        push("success", "instant", `steps ${prev.counts.steps} -> ${entities.counts.steps}`);
      }
      if (prev.counts.parts !== entities.counts.parts) {
        push("success", "instant", `parts ${prev.counts.parts} -> ${entities.counts.parts}`);
      }

      if (pickString(prev.thread?.status) !== pickString(entities.thread?.status)) {
        push(
          "warn",
          "instant",
          `thread.status ${pickString(prev.thread?.status)} -> ${pickString(entities.thread?.status)}`,
          pickString(entities.thread?.updatedAt) || nowIso(),
        );
      }
      if (pickString(prev.context?.status) !== pickString(entities.context?.status)) {
        push(
          "warn",
          "instant",
          `context.status ${pickString(prev.context?.status)} -> ${pickString(entities.context?.status)}`,
          pickString(entities.context?.updatedAt) || nowIso(),
        );
      }

      const prevExecutionIds = new Set((prev.entities.executions ?? []).map((row) => rowId(row)));
      const prevItemIds = new Set((prev.entities.items ?? []).map((row) => rowId(row)));
      const prevStepIds = new Set((prev.entities.steps ?? []).map((row) => rowId(row)));
      const prevPartIds = new Set((prev.entities.parts ?? []).map((row) => rowId(row)));

      for (const execution of entities.entities.executions ?? []) {
        const executionId = rowId(execution);
        if (!executionId || prevExecutionIds.has(executionId)) continue;
        push(
          "success",
          "instant",
          `execution+ id=${executionId} status=${pickString(execution.status)} run=${pickString(execution.workflowRunId)}`,
          pickString(execution.createdAt) || nowIso(),
        );
      }
      for (const item of entities.entities.items ?? []) {
        const itemId = rowId(item);
        if (!itemId || prevItemIds.has(itemId)) continue;
        push(
          "success",
          "instant",
          `item+ id=${itemId} type=${pickString(item.type)} status=${pickString(item.status)} channel=${pickString(item.channel)}`,
          pickString(item.createdAt) || nowIso(),
        );
      }
      for (const step of entities.entities.steps ?? []) {
        const stepId = rowId(step);
        if (!stepId || prevStepIds.has(stepId)) continue;
        push(
          "success",
          "instant",
          `step+ id=${stepId} kind=${pickString(step.kind)} status=${pickString(step.status)} iteration=${String(step.iteration ?? "")}`,
          pickString(step.createdAt) || nowIso(),
        );
      }
      for (const part of entities.entities.parts ?? []) {
        const partId = rowId(part);
        if (!partId || prevPartIds.has(partId)) continue;
        push(
          "success",
          "instant",
          `part+ id=${partId} type=${pickString(part.type)} idx=${String(part.idx ?? "")} step=${pickString(part.stepId)}`,
          pickString(part.updatedAt) || nowIso(),
        );
      }
    }

    previousEntitiesRef.current = entities;
    if (nextEntries.length === 0) return;
    setSyncLog((previous) => [...previous, ...nextEntries].slice(-500));
  }, [entities]);

  useEffect(() => {
    const viewport = streamViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [streamRows.length]);

  useEffect(() => {
    const viewport = syncViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [syncLog.length]);

  const tenantSummary = useMemo(() => {
    if (!tenant) return "No tenant";
    return `${tenant.title} (${tenant.appId})`;
  }, [tenant]);

  const handleReset = useCallback(() => {
    thread.reset();
  }, [thread]);

  const handleStop = useCallback(() => {
    thread.stop();
  }, [thread]);

  return (
    <main
      data-testid="registry-demo-page"
      className="registry-demo-page mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-10"
    >
      <header className="registry-demo-header mb-6 border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Registry demo runtime
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Tenant-aware thread demo
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
              Each browser visitor gets an isolated Instant app. The browser only stores
              <code className="mx-1 rounded bg-muted px-1 py-0.5">appId</code>;
              admin credentials stay server-side.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted/50"
            >
              Back to registry
            </Link>
            <Link
              href="/docs/components/full-agent"
              className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted/50"
            >
              Full agent docs
            </Link>
          </div>
        </div>
      </header>

      <section
        data-testid="registry-demo-tenant-panel"
        className="registry-demo-tenant-panel mb-6 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="registry-demo-tenant-status space-y-1">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Tenant status
            </p>
            <p data-testid="registry-demo-tenant-status-text" className="text-sm">
              {statusText}
            </p>
            <p
              data-testid="registry-demo-tenant-summary"
              className="font-mono text-xs text-muted-foreground"
            >
              {tenantSummary}
            </p>
          </div>
          <div className="registry-demo-tenant-actions flex flex-wrap gap-2">
            <Button
              data-testid="registry-demo-action-recheck-tenant"
              variant="outline"
              onClick={() => void loadTenant()}
              disabled={provisioning}
            >
              {provisioning ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Provisioning
                </span>
              ) : (
                "Re-check tenant"
              )}
            </Button>
            <Button
              data-testid="registry-demo-action-bootstrap-runtime"
              variant="outline"
              onClick={() => void bootstrapTenant()}
              disabled={!tenant?.appId || bootstrapping}
            >
              {bootstrapping ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Bootstrapping
                </span>
              ) : (
                "Bootstrap runtime"
              )}
            </Button>
            <Button
              data-testid="registry-demo-action-destroy-tenant"
              variant="outline"
              onClick={() => void destroyTenant()}
              disabled={!tenant?.appId || destroying}
            >
              {destroying ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Destroying
                </span>
              ) : (
                "Destroy tenant app"
              )}
            </Button>
          </div>
        </div>

        {bootstrap ? (
          <div
            data-testid="registry-demo-bootstrap-stats"
            className="registry-demo-bootstrap-stats mt-4 rounded-lg border border-border/80 bg-background px-3 py-2 font-mono text-xs text-muted-foreground"
          >
            seeded={String(bootstrap.seeded)} threads={bootstrap.counts.threads} contexts=
            {bootstrap.counts.contexts} items={bootstrap.counts.items}
          </div>
        ) : null}
      </section>

      <section className="registry-demo-layout grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <article
          data-testid="registry-demo-thread-panel"
          className="registry-demo-thread-panel rounded-2xl border border-border bg-background shadow-sm"
        >
          <div className="registry-demo-thread-header flex h-12 items-center justify-between border-b bg-muted/40 px-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Codex replay
              </span>
              <span className="text-xs text-muted-foreground">{thread.title}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">context: {thread.contextId}</span>
          </div>

          <div
            data-testid="registry-demo-message-list"
            className="registry-demo-message-list max-h-[540px] overflow-y-auto bg-muted/5 p-4 md:p-6"
          >
            <MessageList thread={thread} toolComponents={{}} showReasoning />
          </div>

          <div className="registry-demo-composer space-y-3 border-t bg-background/95 p-4">
            <textarea
              data-testid="registry-demo-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-[88px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Live replay writes thread entities into InstantDB for real-time visualization.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  data-testid="registry-demo-action-reset-replay"
                  variant="outline"
                  onClick={handleReset}
                  disabled={isRunning}
                >
                  Reset
                </Button>
                <Button
                  data-testid="registry-demo-action-stop-replay"
                  variant="outline"
                  onClick={handleStop}
                  disabled={!isRunning}
                >
                  Stop
                </Button>
                <Button
                  data-testid="registry-demo-action-run-replay"
                  onClick={async () => {
                    await thread.append({
                      parts: [{ type: "text", text: prompt }],
                      reasoningLevel: "low",
                      webSearch: false,
                    });
                  }}
                  disabled={isRunning || !prompt.trim()}
                >
                  Run replay
                </Button>
              </div>
            </div>
          </div>
        </article>

        <aside
          data-testid="registry-demo-observability-panel"
          className="registry-demo-observability-panel space-y-4 rounded-2xl border border-border bg-card p-3"
        >
          <div
            data-testid="registry-demo-stream-panel"
            className="registry-demo-stream-panel rounded-xl border border-border/70 bg-neutral-950 p-3 text-emerald-200 shadow-inner"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
                Stream terminal
              </p>
              <span
                data-testid="registry-demo-stream-count"
                className="font-mono text-xs text-emerald-300/80"
              >
                {streamRows.length}
              </span>
            </div>
            <div
              ref={streamViewportRef}
              data-testid="registry-demo-stream-list"
              className="registry-demo-stream-list max-h-64 space-y-1 overflow-y-auto rounded border border-emerald-700/40 bg-neutral-950 p-2 font-mono text-[11px]"
            >
              {streamRows.map((row) => (
                <div
                  key={row.key}
                  data-testid="registry-demo-stream-row"
                  data-event-order={row.order}
                  className="registry-demo-stream-row grid grid-cols-[34px_78px_98px_minmax(0,1fr)_76px] items-center gap-2 rounded border border-transparent px-2 py-1 text-[11px] hover:border-emerald-600/40"
                >
                  <span
                    data-testid="registry-demo-stream-order"
                    className="text-emerald-300/70"
                  >
                    {row.order}
                  </span>
                  <span
                    data-testid="registry-demo-stream-time"
                    className="text-cyan-300/90"
                  >
                    {formatClock(row.createdAt)}
                  </span>
                  <span
                    data-testid="registry-demo-stream-part"
                    className="truncate text-amber-300"
                  >
                    {row.partType}/{row.partState || "none"}
                  </span>
                  <span
                    data-testid="registry-demo-stream-label"
                    className="truncate text-emerald-100"
                  >
                    {row.label || row.phase || row.eventType}
                  </span>
                  <span
                    data-testid="registry-demo-stream-status"
                    className="truncate text-right text-emerald-300/70"
                  >
                    {row.eventStatus || "stored"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            data-testid="registry-demo-sync-panel"
            className="registry-demo-sync-panel rounded-xl border border-border/70 bg-neutral-950 p-3 text-emerald-200 shadow-inner"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
                Instant sync log
              </p>
              <span
                data-testid="registry-demo-sync-count"
                className="font-mono text-xs text-emerald-300/80"
              >
                {syncLog.length}
              </span>
            </div>
            <div
              ref={syncViewportRef}
              data-testid="registry-demo-sync-list"
              className="registry-demo-sync-list max-h-52 space-y-1 overflow-y-auto rounded border border-emerald-700/40 bg-neutral-950 p-2 font-mono text-[11px]"
            >
              {syncLog.map((row) => (
                <div
                  key={row.id}
                  data-testid="registry-demo-sync-row"
                  className="grid grid-cols-[78px_56px_minmax(0,1fr)] items-center gap-2 rounded px-1 py-0.5"
                >
                  <span className="text-cyan-300/90">{formatClock(row.at)}</span>
                  <span
                    className={
                      row.level === "success"
                        ? "text-emerald-300"
                        : row.level === "warn"
                          ? "text-amber-300"
                          : "text-emerald-300/70"
                    }
                  >
                    {row.source}
                  </span>
                  <span className="truncate text-emerald-100">{row.message}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            data-testid="registry-demo-entities-panel"
            className="registry-demo-entities-panel rounded-xl border border-border/70 bg-background p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Instant entities
              </p>
              <span
                data-testid="registry-demo-entities-syncing"
                className="font-mono text-xs text-muted-foreground"
              >
                {syncingEntities ? "syncing" : "idle"}
              </span>
            </div>

            <div className="registry-demo-entity-counts mb-3 grid grid-cols-2 gap-2 text-xs">
              <div data-testid="registry-demo-entity-count-executions" className="rounded border px-2 py-1">
                executions: {entities?.counts.executions ?? 0}
              </div>
              <div data-testid="registry-demo-entity-count-items" className="rounded border px-2 py-1">
                items: {entities?.counts.items ?? 0}
              </div>
              <div data-testid="registry-demo-entity-count-steps" className="rounded border px-2 py-1">
                steps: {entities?.counts.steps ?? 0}
              </div>
              <div data-testid="registry-demo-entity-count-parts" className="rounded border px-2 py-1">
                parts: {entities?.counts.parts ?? 0}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Executions
                </p>
                <div
                  data-testid="registry-demo-entities-executions-list"
                  className="max-h-28 space-y-1 overflow-y-auto rounded border border-border/60 p-1"
                >
                  {(entities?.entities.executions ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="registry-demo-entities-execution-row"
                      className="grid grid-cols-[1fr_auto] gap-2 rounded px-1 py-0.5 text-[11px]"
                    >
                      <span className="truncate font-mono text-foreground">{String(row.id)}</span>
                      <span className="text-muted-foreground">{String(row.status ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Items
                </p>
                <div
                  data-testid="registry-demo-entities-items-list"
                  className="max-h-28 space-y-1 overflow-y-auto rounded border border-border/60 p-1"
                >
                  {(entities?.entities.items ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="registry-demo-entities-item-row"
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-2 rounded px-1 py-0.5 text-[11px]"
                    >
                      <span className="truncate font-mono text-foreground">{String(row.id)}</span>
                      <span className="text-muted-foreground">{String(row.type ?? "")}</span>
                      <span className="text-muted-foreground">{String(row.status ?? "")}</span>
                      <span className="text-muted-foreground">{String(row.channel ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Steps
                </p>
                <div
                  data-testid="registry-demo-entities-steps-list"
                  className="max-h-28 space-y-1 overflow-y-auto rounded border border-border/60 p-1"
                >
                  {(entities?.entities.steps ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="registry-demo-entities-step-row"
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-2 rounded px-1 py-0.5 text-[11px]"
                    >
                      <span className="truncate font-mono text-foreground">{String(row.id)}</span>
                      <span className="text-muted-foreground">{String(row.kind ?? "")}</span>
                      <span className="text-muted-foreground">{String(row.status ?? "")}</span>
                      <span className="text-muted-foreground">
                        {String(row.iteration ?? "")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Parts
                </p>
                <div
                  data-testid="registry-demo-entities-parts-list"
                  className="max-h-28 space-y-1 overflow-y-auto rounded border border-border/60 p-1"
                >
                  {(entities?.entities.parts ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="registry-demo-entities-part-row"
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-2 rounded px-1 py-0.5 text-[11px]"
                    >
                      <span className="truncate font-mono text-foreground">{String(row.id)}</span>
                      <span className="text-muted-foreground">{String(row.type ?? "")}</span>
                      <span className="text-muted-foreground">{String(row.idx ?? "")}</span>
                      <span className="truncate text-muted-foreground">{String(row.stepId ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
