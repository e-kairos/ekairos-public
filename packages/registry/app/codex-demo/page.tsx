"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageList } from "@/components/ekairos/agent/ui/message-list";
import { useLiveCodexThread } from "@/components/ekairos/agent/live/use-live-codex-thread";

export default function CodexDemoPage() {
  const thread = useLiveCodexThread();
  const [prompt, setPrompt] = useState("Inspect README.md and summarize the key points.");

  const isRunning =
    thread.contextStatus === "streaming" || thread.sendStatus === "submitting";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4">
      <header className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Codex Demo
            </p>
            <h1 className="text-2xl font-semibold">Live Codex reactor on local app server</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This page uses `createCodexReactor` through `/api/codex-demo/run`.
              Chunks are reduced into step/part rendering.
            </p>
          </div>
          <Link
            href="/demo"
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Back to scripted demo
          </Link>
        </div>
        <div className="mt-3 grid gap-2 font-mono text-[11px] md:grid-cols-2">
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            contextId: {thread.contextId}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            providerThreadId: {thread.profile.threadId}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            model: {thread.profile.model || "-"}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            sendStatus: {thread.sendStatus}
          </div>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <article className="rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex h-12 items-center justify-between border-b bg-muted/40 px-4">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Codex live stream
            </span>
            <span className="text-xs text-muted-foreground">
              {thread.title}
            </span>
          </div>
          <div
            data-testid="codex-demo-message-list"
            className="max-h-[560px] overflow-y-auto p-4 md:p-6"
          >
            <MessageList thread={thread} toolComponents={{}} showReasoning />
          </div>
          <div className="space-y-3 border-t bg-background/95 p-4">
            <textarea
              data-testid="codex-demo-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-[100px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Requires `CODEX_APP_SERVER_URL` (default: `http://127.0.0.1:4310/turn`).
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={thread.reset}
                  disabled={isRunning}
                  data-testid="codex-demo-reset"
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  onClick={thread.stop}
                  disabled={!isRunning}
                  data-testid="codex-demo-stop"
                >
                  Stop
                </Button>
                <Button
                  onClick={async () => {
                    await thread.append({
                      parts: [{ type: "text", text: prompt }],
                      reasoningLevel: "low",
                      webSearch: false,
                    });
                  }}
                  disabled={isRunning || !prompt.trim()}
                  data-testid="codex-demo-run"
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

        <aside className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="rounded-xl border border-border/70 bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Turn substate
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">
              {thread.turnSubstateKey || "idle"}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Last error
            </p>
            <p
              data-testid="codex-demo-last-error"
              className="mt-1 whitespace-pre-wrap font-mono text-xs text-foreground"
            >
              {thread.sendError || "-"}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Notes
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Uses real Codex App Server notifications.</li>
              <li>Maps through `createCodexReactor` into thread parts.</li>
              <li>Renders steps/parts (not raw chunk cards).</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
