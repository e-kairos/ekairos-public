"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MessageList } from "@/components/ekairos/agent/ui/message-list";
import { Button } from "@/components/ui/button";
import { asString } from "@/lib/examples/reactors/codex/shared";
import { useLiveCodexShowcase } from "@/lib/examples/reactors/codex/use-live-showcase";
import { useOrgDb } from "@/lib/org-db-context";

function formatEntries(entries: Record<string, number>) {
  return Object.entries(entries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

function formatUsage(tokenUsage: Record<string, unknown>) {
  const total =
    typeof tokenUsage.totalTokens === "number"
      ? tokenUsage.totalTokens
      : tokenUsage.total_tokens;
  const input =
    typeof tokenUsage.inputTokens === "number"
      ? tokenUsage.inputTokens
      : tokenUsage.input_tokens;
  const output =
    typeof tokenUsage.outputTokens === "number"
      ? tokenUsage.outputTokens
      : tokenUsage.output_tokens;

  const parts = [];
  if (typeof total === "number") parts.push(`total=${total}`);
  if (typeof input === "number") parts.push(`in=${input}`);
  if (typeof output === "number") parts.push(`out=${output}`);
  return parts.join(" ") || "-";
}

function CodexReactorShowcaseReadyPage() {
  const context = useLiveCodexShowcase();
  const [prompt, setPrompt] = useState(context.definition.initialPrompt);

  const isRunning =
    context.contextStatus === "streaming" || context.sendStatus === "submitting";
  const chunkTypeEntries = useMemo(
    () => formatEntries(context.trace?.summary.chunkTypes ?? {}),
    [context.trace],
  );
  const providerEntries = useMemo(
    () => formatEntries(context.trace?.summary.providerChunkTypes ?? {}),
    [context.trace],
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
      <header className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Reactor Showcase
            </p>
            <h1 className="text-2xl font-semibold">{context.definition.title}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {context.definition.description}
            </p>
          </div>
          <Link
            href="/examples"
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Back to examples
          </Link>
        </div>

        <div className="mt-4 grid gap-2 font-mono text-[11px] md:grid-cols-2 xl:grid-cols-4">
          <div
            data-testid="examples-codex-tenant-summary"
            className="rounded border border-border/70 bg-background px-2 py-1"
          >
            appId: {context.tenantAppId || context.tenantStatus}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            contextId: {context.contextId}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            sendStatus: {context.sendStatus}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            model: {asString(context.llm?.model) || "-"}
          </div>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <article className="rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex h-12 items-center justify-between border-b bg-muted/40 px-4">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Live Codex context
            </span>
            <span className="text-xs text-muted-foreground">{context.title}</span>
          </div>

          <div
            data-testid="examples-codex-message-list"
            className="max-h-[560px] overflow-y-auto p-4 md:p-6"
          >
            <MessageList context={context} toolComponents={{}} showReasoning />
          </div>

          <div className="space-y-3 border-t bg-background/95 p-4">
            <textarea
              data-testid="examples-codex-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-[100px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Uses the ephemeral tenant session and the local Codex app-server bridge.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={context.reset}
                  disabled={isRunning}
                  data-testid="examples-codex-reset"
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  onClick={context.stop}
                  disabled={!isRunning}
                  data-testid="examples-codex-stop"
                >
                  Stop
                </Button>
                <Button
                  onClick={async () => {
                    await context.append({
                      parts: [{ type: "text", text: prompt }],
                      reasoningLevel: "low",
                      webSearch: false,
                    });
                  }}
                  disabled={isRunning || !prompt.trim()}
                  data-testid="examples-codex-run"
                >
                  {isRunning ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running
                    </span>
                  ) : (
                    "Run"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </article>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Turn state
            </p>
            <div className="mt-2 space-y-2 font-mono text-xs">
              <div>status: {context.sendStatus}</div>
              <div>substate: {context.turnSubstateKey || "idle"}</div>
              <div
                data-testid="examples-codex-last-error"
                className="whitespace-pre-wrap text-foreground"
              >
                error: {context.sendError || "-"}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Provider metadata
            </p>
            <div className="mt-2 space-y-2 font-mono text-xs">
              <div
                data-testid="examples-codex-metadata-provider-context-id"
                className="break-all"
              >
                providerContextId: {context.metadata.providerContextId || "-"}
              </div>
              <div data-testid="examples-codex-metadata-turn-id" className="break-all">
                turnId: {context.metadata.turnId || "-"}
              </div>
              <div
                data-testid="examples-codex-metadata-usage"
                className="break-all"
              >
                usage: {formatUsage(context.metadata.tokenUsage)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Stream trace
            </p>
            <div className="mt-2 space-y-2 font-mono text-xs">
              <div>events: {context.trace?.summary.eventCount ?? 0}</div>
              <div>chunks: {context.trace?.summary.chunkCount ?? 0}</div>
              <div>streamTrace.totalChunks: {context.trace?.summary.streamTraceTotalChunks ?? 0}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  chunk types
                </p>
                <div className="space-y-1 font-mono text-[11px]">
                  {chunkTypeEntries.length > 0 ? (
                    chunkTypeEntries.map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{key}</span>
                        <span>{value}</span>
                      </div>
                    ))
                  ) : (
                    <div>-</div>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  provider events
                </p>
                <div className="space-y-1 font-mono text-[11px]">
                  {providerEntries.length > 0 ? (
                    providerEntries.map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{key}</span>
                        <span>{value}</span>
                      </div>
                    ))
                  ) : (
                    <div>-</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Order audit
              </p>
              <span
                className={
                  context.audit?.orderMatches
                    ? "font-mono text-[11px] text-emerald-600"
                    : "font-mono text-[11px] text-amber-600"
                }
              >
                {context.audit ? (context.audit.orderMatches ? "match" : "mismatch") : "-"}
              </span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  provider order
                </p>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border/60 p-2 font-mono text-[11px]">
                  {(context.audit?.providerOrder ?? []).map((row, index) => (
                    <div key={`provider:${index}`} className="grid grid-cols-[36px_92px_minmax(0,1fr)] gap-2">
                      <span>{String(row.sequence ?? "")}</span>
                      <span className="truncate">{String(row.type ?? "")}</span>
                      <span className="truncate">{String(row.preview ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  persisted order
                </p>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border/60 p-2 font-mono text-[11px]">
                  {(context.audit?.persistedOrder ?? []).map((row, index) => (
                    <div key={`persisted:${index}`} className="grid grid-cols-[36px_92px_minmax(0,1fr)] gap-2">
                      <span>{String(row.sequence ?? "")}</span>
                      <span className="truncate">{String(row.type ?? "")}</span>
                      <span className="truncate">{String(row.preview ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Command executions
              </p>
              <span data-testid="examples-codex-command-count" className="font-mono text-xs">
                {context.commandExecutions.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {context.commandExecutions.length > 0 ? (
                context.commandExecutions.map((part, index) => {
                  const input =
                    part.input && typeof part.input === "object"
                      ? (part.input as Record<string, unknown>)
                      : {};
                  const output =
                    part.output && typeof part.output === "object"
                      ? (part.output as Record<string, unknown>)
                      : {};

                  return (
                    <div
                      key={`${asString(part.toolCallId)}:${index}`}
                      data-testid="examples-codex-command-row"
                      className="rounded border border-border/70 bg-background p-2 font-mono text-[11px]"
                    >
                      <div className="break-all">command: {asString(input.command) || "-"}</div>
                      <div>status: {asString(output.status) || asString(part.state) || "-"}</div>
                      <div>exitCode: {asString(output.exitCode) || "-"}</div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">No command executions yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Persisted snapshot
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div
                data-testid="examples-codex-entity-count-executions"
                className="rounded border border-border/70 bg-background px-2 py-1"
              >
                executions: {context.entities?.counts.executions ?? 0}
              </div>
              <div
                data-testid="examples-codex-entity-count-items"
                className="rounded border border-border/70 bg-background px-2 py-1"
              >
                items: {context.entities?.counts.items ?? 0}
              </div>
              <div
                data-testid="examples-codex-entity-count-steps"
                className="rounded border border-border/70 bg-background px-2 py-1"
              >
                steps: {context.entities?.counts.steps ?? 0}
              </div>
              <div
                data-testid="examples-codex-entity-count-parts"
                className="rounded border border-border/70 bg-background px-2 py-1"
              >
                parts: {context.entities?.counts.parts ?? 0}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  items
                </p>
                <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-border/60 p-1">
                  {(context.entities?.entities.items ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="examples-codex-entity-item-row"
                      className="grid grid-cols-[1fr_auto_auto] gap-2 font-mono text-[11px]"
                    >
                      <span className="truncate">{String(row.id)}</span>
                      <span>{String(row.type ?? "")}</span>
                      <span>{String(row.status ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  steps
                </p>
                <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-border/60 p-1">
                  {(context.entities?.entities.steps ?? []).map((row) => (
                    <div
                      key={String(row.id)}
                      data-testid="examples-codex-entity-step-row"
                      className="grid grid-cols-[1fr_auto_auto] gap-2 font-mono text-[11px]"
                    >
                      <span className="truncate">{String(row.id)}</span>
                      <span>{String(row.kind ?? "")}</span>
                      <span>{String(row.status ?? "")}</span>
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

export function CodexReactorShowcasePage() {
  const { db } = useOrgDb();

  if (!db) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-5 md:px-6">
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Initializing tenant runtime...
        </div>
      </main>
    );
  }

  return <CodexReactorShowcaseReadyPage />;
}
