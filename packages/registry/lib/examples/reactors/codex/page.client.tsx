"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MessageList } from "@/components/ekairos/agent/ui/message-list";
import { Button } from "@/components/ui/button";
import { asString } from "@/lib/examples/reactors/codex/shared";
import { useLiveCodexShowcase } from "@/lib/examples/reactors/codex/use-live-showcase";
import { useOrgDb } from "@/lib/org-db-context";

function CodexReactorShowcaseReadyPage() {
  const context = useLiveCodexShowcase();
  const [prompt, setPrompt] = useState(context.definition.initialPrompt);

  const isRunning =
    context.contextStatus === "open_streaming" || context.sendStatus === "submitting";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 md:px-6">
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
          <div className="flex items-center gap-2">
            <Link
              href="/showcases/codex-steps"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Open steps showcase
            </Link>
            <Link
              href="/examples"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Back to examples
            </Link>
          </div>
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
            <p
              data-testid="examples-codex-status"
              className="text-xs text-muted-foreground"
            >
              {context.sendError
                ? `error: ${context.sendError}`
                : isRunning
                  ? "running codex reactor..."
                  : "Uses the ephemeral tenant session and the local Codex app-server bridge."}
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
