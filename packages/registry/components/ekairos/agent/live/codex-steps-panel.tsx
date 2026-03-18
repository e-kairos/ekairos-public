"use client";

import { RefreshCcw } from "lucide-react";
import { MessageParts } from "@/components/ekairos/agent/ui/message-parts";
import { Button } from "@/components/ui/button";
import type { CodexStepsController } from "./codex-steps-state";
import { CodexStepsParts } from "./codex-steps-parts";

function formatReplayState(value: string) {
  if (value === "loading") return "loading";
  if (value === "replaying") return "replaying";
  if (value === "live") return "live";
  if (value === "completed") return "completed";
  if (value === "error") return "error";
  return "idle";
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStatus(value: CodexStepsController["status"]) {
  if (value === "bootstrapping") return "bootstrapping";
  if (value === "streaming") return "streaming";
  if (value === "completed") return "completed";
  return "error";
}

export function CodexStepsPanel({ controller }: { controller: CodexStepsController }) {
  const selectedStep =
    controller.steps.find((step) => step.stepId === controller.selectedStepId) ?? null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-4 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Codex Steps
            </span>
            <span
              data-testid="codex-steps-panel-status"
              className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {formatStatus(controller.status)}
            </span>
          </div>
          <div className="grid gap-2 font-mono text-[11px] text-muted-foreground md:grid-cols-2">
            <div
              data-testid="codex-steps-panel-context-id"
              className="rounded border border-border/70 bg-background px-2 py-1"
            >
              contextId: {controller.contextId || "-"}
            </div>
            <div
              data-testid="codex-steps-panel-execution-id"
              className="rounded border border-border/70 bg-background px-2 py-1"
            >
              executionId: {controller.executionId || "-"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            data-testid="codex-steps-panel-replay-status"
            className="rounded border border-border/70 bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
          >
            {formatReplayState(controller.replayStatus)} {formatBytes(controller.replayByteOffset)}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void controller.restart()}
            data-testid="codex-steps-panel-restart"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Restart
          </Button>
        </div>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-border/70 bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Persisted steps
              </p>
              <span className="font-mono text-[11px] text-muted-foreground">
                {controller.steps.length}
              </span>
            </div>

            <div className="space-y-2">
              {controller.steps.length > 0 ? (
                controller.steps.map((step) => {
                  const isSelected = step.stepId === controller.selectedStepId;
                  return (
                    <button
                      key={step.stepId}
                      type="button"
                      onClick={() => controller.selectStep(step.stepId)}
                      data-testid="codex-steps-panel-step-row"
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
                <p className="text-sm text-muted-foreground">Waiting for step bootstrap...</p>
              )}
            </div>
          </div>
        </aside>

        <div className="space-y-3">
          <div
            data-testid="codex-steps-panel-selected-step"
            className="rounded-2xl border border-border/70 bg-background p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Selected step
                </p>
                <p className="mt-1 text-sm font-medium">
                  {selectedStep?.stepId || "No step selected"}
                </p>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                storedParts={controller.currentStoredParts.length}
              </span>
            </div>

            {controller.currentEvent ? (
              <div className="space-y-3">
                <CodexStepsParts parts={controller.currentEvent.content.parts} />
                <div className="rounded-2xl border border-border/70 bg-card p-3">
                  <MessageParts
                    message={{
                      id: controller.currentEvent.id,
                      role: "assistant",
                      parts: controller.currentEvent.content.parts,
                      metadata: {
                        eventId: controller.currentEvent.id,
                        type: controller.currentEvent.type,
                        channel: controller.currentEvent.channel,
                        createdAt: controller.currentEvent.createdAt,
                        status: controller.currentEvent.status,
                      },
                    }}
                    status={
                      controller.replayStatus === "loading" ||
                      controller.replayStatus === "replaying" ||
                      controller.replayStatus === "live"
                        ? "streaming"
                        : "ready"
                    }
                    isLatest
                    toolComponents={{}}
                    showReasoning
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No replay event available yet.</p>
            )}
          </div>

          <div className="rounded-2xl border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Stored parts
            </p>
            <pre
              data-testid="codex-steps-panel-stored-parts"
              className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/60 p-3 font-mono text-[11px] whitespace-pre-wrap"
            >
              {JSON.stringify(controller.currentStoredParts, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
