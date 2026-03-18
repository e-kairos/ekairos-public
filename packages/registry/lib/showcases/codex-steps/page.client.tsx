"use client";

import Link from "next/link";
import { CodexStepsPanel } from "@/components/ekairos/agent/live/codex-steps-panel";
import { useCodexStepsClientScenario } from "@/components/ekairos/agent/live/use-codex-steps-client-scenario";
import type { AppSchema } from "@/instant.schema";
import { useOrgDb } from "@/lib/org-db-context";
import type { InstantReactWebDatabase } from "@instantdb/react";

function CodexStepsClientScenarioReadyPage({
  db,
}: {
  db: InstantReactWebDatabase<AppSchema>;
}) {
  const controller = useCodexStepsClientScenario(db);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-8 md:px-6">
      <header className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Internal showcase
            </p>
            <h1 className="text-2xl font-semibold">Codex Steps Client Scenario</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              This route bootstraps the Codex execution shape directly from the browser:
              context, trigger item, execution, step, persisted parts, and live Instant
              stream.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/examples/codex"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Open full chat
            </Link>
            <Link
              href="/examples"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Back to examples
            </Link>
          </div>
        </div>
      </header>

      <CodexStepsPanel controller={controller} />
    </main>
  );
}

export function CodexStepsClientScenarioPage() {
  const { db } = useOrgDb();

  if (!db) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 md:px-6">
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Initializing tenant runtime...
        </div>
      </main>
    );
  }

  return <CodexStepsClientScenarioReadyPage db={db} />;
}
