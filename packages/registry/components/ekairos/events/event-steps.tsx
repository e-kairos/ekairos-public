"use client";

import React from "react";
import type { ComponentType } from "react";
import { RefreshCcw } from "lucide-react";
import { MessageParts } from "@/components/ekairos/agent/ui/message-parts";
import { Button } from "@/components/ui/button";

export type EventStepView = {
  stepId: string;
  executionId: string | null;
  status: string;
  kind: string;
  preview: string;
};

export type EventStepsController = {
  status: "bootstrapping" | "streaming" | "completed" | "error";
  contextId: string | null;
  executionId: string | null;
  selectedStepId: string | null;
  steps: EventStepView[];
  replayStatus: "idle" | "loading" | "replaying" | "live" | "completed" | "error";
  replayByteOffset: number;
  currentEvent: {
    id: string;
    type: string;
    channel: string;
    createdAt: string | Date;
    status?: string;
    content: { parts: any[] };
  } | null;
  currentStoredParts: Array<Record<string, unknown>>;
  selectStep: (stepId: string) => void;
  restart: () => Promise<void>;
};

export type EventStepRendererProps = {
  step: EventStepView;
  event: EventStepsController["currentEvent"];
  replayStatus: EventStepsController["replayStatus"];
  storedParts: EventStepsController["currentStoredParts"];
  toolComponents?: Record<string, any>;
  showReasoning?: boolean;
};

export type EventStepRenderer = ComponentType<EventStepRendererProps>;
export type EventStepComponents = Record<string, EventStepRenderer>;

export type EventStepsProps = {
  controller: EventStepsController;
  stepComponents?: EventStepComponents;
  toolComponents?: Record<string, any>;
  showReasoning?: boolean;
};

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function DefaultEventStepRenderer({
  step,
  event,
  replayStatus,
  storedParts,
  toolComponents,
  showReasoning = true,
}: EventStepRendererProps) {
  return (
    <div className="space-y-3">
      <div
        data-testid="event-steps-selected-step"
        className="rounded-2xl border border-border/70 bg-background p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Selected step
            </p>
            <p className="mt-1 text-sm font-medium">{step.stepId || "No step selected"}</p>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            storedParts={storedParts.length}
          </span>
        </div>

        {event ? (
          <div className="rounded-2xl border border-border/70 bg-card p-3">
            <MessageParts
              message={{
                id: event.id,
                role: "assistant",
                parts: event.content.parts,
                metadata: {
                  eventId: event.id,
                  type: event.type,
                  channel: event.channel,
                  createdAt: event.createdAt,
                  status: event.status,
                },
              }}
              status={
                replayStatus === "loading" || replayStatus === "replaying" || replayStatus === "live"
                  ? "streaming"
                  : "ready"
              }
              isLatest
              toolComponents={toolComponents || {}}
              showReasoning={showReasoning}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No replay event available yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-border/70 bg-background p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Stored parts</p>
        <pre
          data-testid="event-steps-stored-parts"
          className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/60 p-3 font-mono text-[11px] whitespace-pre-wrap"
        >
          {JSON.stringify(storedParts, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function resolveStepRenderer(params: {
  step: EventStepView | null;
  stepComponents?: EventStepComponents;
}): EventStepRenderer {
  if (!params.step) return DefaultEventStepRenderer;

  const byKind = params.stepComponents?.[params.step.kind];
  if (byKind) return byKind;

  const fallback = params.stepComponents?.default;
  if (fallback) return fallback;

  return DefaultEventStepRenderer;
}

export function EventSteps({
  controller,
  stepComponents,
  toolComponents,
  showReasoning = true,
}: EventStepsProps) {
  const selectedStep =
    controller.steps.find((step) => step.stepId === controller.selectedStepId) ?? null;
  const StepRenderer = resolveStepRenderer({ step: selectedStep, stepComponents });

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-4 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Event steps
            </span>
            <span
              data-testid="event-steps-status"
              className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {controller.status}
            </span>
          </div>
          <div className="grid gap-2 font-mono text-[11px] text-muted-foreground md:grid-cols-2">
            <div
              data-testid="event-steps-context-id"
              className="rounded border border-border/70 bg-background px-2 py-1"
            >
              contextId: {controller.contextId || "-"}
            </div>
            <div
              data-testid="event-steps-execution-id"
              className="rounded border border-border/70 bg-background px-2 py-1"
            >
              executionId: {controller.executionId || "-"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            data-testid="event-steps-replay-status"
            className="rounded border border-border/70 bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
          >
            {controller.replayStatus} {formatBytes(controller.replayByteOffset)}
          </div>
          <Button variant="outline" size="sm" onClick={() => void controller.restart()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Restart
          </Button>
        </div>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div data-testid="event-steps-step-list" className="space-y-2">
            {controller.steps.length > 0 ? (
              controller.steps.map((step) => {
                const isSelected = step.stepId === controller.selectedStepId;
                return (
                  <button
                    key={step.stepId}
                    type="button"
                    onClick={() => controller.selectStep(step.stepId)}
                    data-testid="event-steps-step-row"
                    className={
                      isSelected
                        ? "w-full rounded-xl border border-foreground/20 bg-muted px-3 py-3 text-left"
                        : "w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left hover:bg-muted/40"
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{step.kind || "message"}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {step.stepId}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {step.status}
                      </span>
                    </div>
                    {step.preview ? (
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {step.preview}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">No stored preview yet.</p>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
                Waiting for step bootstrap...
              </div>
            )}
          </div>
        </aside>

        <div className="space-y-3">
          {selectedStep ? (
            <StepRenderer
              step={selectedStep}
              event={controller.currentEvent}
              replayStatus={controller.replayStatus}
              storedParts={controller.currentStoredParts}
              toolComponents={toolComponents}
              showReasoning={showReasoning}
            />
          ) : (
            <div className="rounded-2xl border border-border/70 bg-background p-4 text-sm text-muted-foreground">
              No step selected.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default EventSteps;
