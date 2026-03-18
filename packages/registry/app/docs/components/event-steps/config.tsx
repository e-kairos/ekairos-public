"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type { InstantReactWebDatabase } from "@instantdb/react";
import type { RegistryItem } from "@/lib/registry-types";
import EventSteps from "@/components/ekairos/events/event-steps";
import type { AppSchema } from "@/instant.schema";
import { useOrgDb } from "@/lib/org-db-context";
import {
  aiSdkEventsScenario,
  codexEventsScenario,
  scriptedEventsScenario,
  useEventDemoScenario,
} from "@/lib/domains/events/demo-scenarios";

const scenarios = [
  scriptedEventsScenario,
  aiSdkEventsScenario,
  codexEventsScenario,
] as const;

function EventStepsDemoReadyPreview({
  db,
}: {
  db: InstantReactWebDatabase<AppSchema>;
}) {
  const [activeScenarioId, setActiveScenarioId] = React.useState<string>(scriptedEventsScenario.id);
  const activeScenario =
    scenarios.find((scenario) => scenario.id === activeScenarioId) ?? scriptedEventsScenario;
  const controller = useEventDemoScenario({
    db,
    scenario: activeScenario,
  });

  return (
    <div className="w-full space-y-4">
      <div className="rounded-2xl border border-border/80 bg-card px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">
              live scenario
            </p>
            <h3 className="text-lg font-medium">{activeScenario.title}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {activeScenario.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {scenarios.map((scenario) => (
              <Button
                key={scenario.id}
                type="button"
                size="sm"
                variant={scenario.id === activeScenario.id ? "default" : "outline"}
                onClick={() => setActiveScenarioId(scenario.id)}
                data-testid={`event-steps-scenario-${scenario.reactor}`}
              >
                {scenario.title}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 font-mono text-[11px] text-muted-foreground md:grid-cols-2">
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            reactor: {activeScenario.reactor}
          </div>
          <div className="rounded border border-border/70 bg-background px-2 py-1">
            prompt: {activeScenario.prompt}
          </div>
        </div>
      </div>

      <EventSteps controller={controller} />
    </div>
  );
}

function EventStepsDemoPreview() {
  const { db } = useOrgDb();

  if (!db) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Initializing tenant runtime...
      </div>
    );
  }

  return <EventStepsDemoReadyPreview db={db} />;
}

export const eventStepsRegistryItem: RegistryItem = {
  id: "event-steps",
  registryName: "ekairos-events-event-steps",
  title: "Event Steps",
  subtitle:
    "Domain component for rendering persisted `event_steps`, replaying the linked stream, and inspecting the current event payload.",
  category: "compound",
  previewMode: "ephemeral-app",
  previewHint:
    "The preview uses the current ephemeral Instant app and lets you swap between scripted, AI SDK, and Codex reactor scenarios over real persisted data and streams.",
  props: [
    {
      name: "controller",
      type: "EventStepsController",
      description: "Domain-shaped controller containing steps, current event, replay state, and actions.",
    },
    {
      name: "stepComponents",
      type: "Record<string, EventStepRenderer>",
      default: "{}",
      description:
        "Optional map of step renderers keyed by `event_steps.kind`, plus an optional `default` renderer.",
    },
    {
      name: "toolComponents",
      type: "Record<string, React.ComponentType<any>>",
      default: "{}",
      description: "Forwarded to the default step renderer so part-level tool views stay injectable.",
    },
    {
      name: "showReasoning",
      type: "boolean",
      default: "true",
      description: "Controls whether the default step renderer expands reasoning parts.",
    },
  ],
  code: `"use client"

import EventSteps from "@/components/ekairos/events/event-steps"
import { EventStepTerminalRenderer } from "@/components/ekairos/events/event-step-terminal-renderer"

export function EventStepsPreview({ controller }) {
  return (
    <EventSteps
      controller={controller}
      stepComponents={{
        message: EventStepTerminalRenderer,
      }}
    />
  )
}
`,
  render: () => <EventStepsDemoPreview />,
};
