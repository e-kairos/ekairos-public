"use client";

import Link from "next/link";
import type { InstantReactWebDatabase } from "@instantdb/react";
import EventSteps from "@/components/ekairos/events/event-steps";
import type { AppSchema } from "@/instant.schema";
import { useOrgDb } from "@/lib/org-db-context";
import { useEventDemoScenario, type EventDemoScenario } from "./demo-scenarios";

function EventDemoReadyPage({
  scenario,
  db,
}: {
  scenario: EventDemoScenario;
  db: InstantReactWebDatabase<AppSchema>;
}) {
  const controller = useEventDemoScenario({ db, scenario });

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
          Events · Demo
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{scenario.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {scenario.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/docs/domains/events"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Back to events
            </Link>
          </div>
        </div>
      </header>

      <EventSteps controller={controller} />
    </article>
  );
}

export function EventDemoPage({ scenario }: { scenario: EventDemoScenario }) {
  const { db } = useOrgDb();

  if (!db) {
    return (
      <article className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Initializing tenant runtime...
      </article>
    );
  }

  return <EventDemoReadyPage scenario={scenario} db={db} />;
}
