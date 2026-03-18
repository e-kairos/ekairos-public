"use client";

import React, { useMemo } from "react";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";

type CodexStepsPartsProps = {
  parts: Array<Record<string, unknown>>;
};

type StepKind = "turn" | "reasoning" | "message" | "action" | "usage" | "runtime";

type StepPartView = {
  summary: string;
  detail?: string;
  state: string;
  provider: string;
  command?: string;
  terminalOutput?: string;
  terminalStreaming?: boolean;
};

type StepView = {
  id: StepKind;
  title: string;
  status: "running" | "completed";
  parts: StepPartView[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function detectStepKind(phase: string, provider: string): StepKind {
  const normalized = `${phase} ${provider}`.toLowerCase();
  if (normalized.includes("reasoning")) return "reasoning";
  if (normalized.includes("text_") || normalized.includes("agentmessage")) return "message";
  if (normalized.includes("action") || normalized.includes("tool")) return "action";
  if (
    normalized.includes("tokenusage") ||
    normalized.includes("response_metadata") ||
    normalized.includes("usage")
  ) {
    return "usage";
  }
  if (
    normalized.includes("turn/") ||
    normalized.includes("chunk.start") ||
    normalized.includes("chunk.finish")
  ) {
    return "turn";
  }
  return "runtime";
}

function stepTitle(kind: StepKind): string {
  if (kind === "turn") return "Turn";
  if (kind === "reasoning") return "Reasoning";
  if (kind === "message") return "Message";
  if (kind === "action") return "Actions";
  if (kind === "usage") return "Usage";
  return "Runtime";
}

function isCompleted(phase: string, provider: string, state: string): boolean {
  const normalized = `${phase} ${provider}`.toLowerCase();
  if (state === "output-available") return true;
  return (
    normalized.includes("finish") ||
    normalized.includes("completed") ||
    normalized.includes("reasoning_end") ||
    normalized.includes("text_end") ||
    normalized.includes("action_output_available")
  );
}

function extractText(detail: Record<string, unknown>): string {
  const chunkData = asRecord(detail.chunkData);
  const params = asRecord(chunkData.params);
  const item = asRecord(params.item);
  return (
    asString(params.delta) ||
    asString(chunkData.delta) ||
    asString(params.text) ||
    asString(chunkData.text) ||
    asString(item.text) ||
    asString(item.summary)
  );
}

function extractTokenSummary(detail: Record<string, unknown>): string {
  const chunkData = asRecord(detail.chunkData);
  const params = asRecord(chunkData.params);
  const tokenUsage = asRecord(params.tokenUsage);
  const total = asRecord(tokenUsage.total);
  const totalTokens = total.totalTokens;
  const inputTokens = total.inputTokens;
  const outputTokens = total.outputTokens;
  if (
    typeof totalTokens === "number" ||
    typeof inputTokens === "number" ||
    typeof outputTokens === "number"
  ) {
    return `total=${String(totalTokens || 0)} in=${String(inputTokens || 0)} out=${String(outputTokens || 0)}`;
  }
  return "";
}

function extractAction(detail: Record<string, unknown>): string {
  const actionRef = asString(detail.actionRef);
  if (actionRef) return actionRef;
  const chunkData = asRecord(detail.chunkData);
  const params = asRecord(chunkData.params);
  return asString(params.toolCallId || params.itemId || params.id);
}

function isCommandExecutionPart(part: Record<string, unknown>): boolean {
  return asString(part.type) === "tool-commandExecution";
}

function toVirtualCodexParts(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const virtualParts: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    const output = asRecord(part.output);
    const streamTrace = asRecord(output.streamTrace);
    const traceChunks = Array.isArray(streamTrace.chunks) ? streamTrace.chunks : [];
    if (traceChunks.length === 0) {
      virtualParts.push(part);
      continue;
    }

    for (const traceChunkRaw of traceChunks) {
      const traceChunk = asRecord(traceChunkRaw);
      const chunkType = asString(traceChunk.chunkType);
      const providerChunkType = asString(traceChunk.providerChunkType);
      const detail = asRecord(traceChunk.data);
      const label =
        asString(asRecord(detail.params).delta) ||
        asString(asRecord(detail.params).text) ||
        asString(detail.method) ||
        providerChunkType ||
        chunkType ||
        "event";

      virtualParts.push({
        type: "codex-event",
        state:
          chunkType.includes("finish") ||
          chunkType.includes("_end") ||
          chunkType.includes("output_available")
            ? "output-available"
            : "output-streaming",
        output: {
          phase: chunkType,
          chunkType,
          providerChunkType,
          label,
          detail: {
            chunkData: detail,
            actionRef: asString(traceChunk.actionRef),
          },
        },
        metadata: {
          phase: chunkType,
          chunkType,
          providerChunkType,
          label,
        },
      });
    }
  }
  return virtualParts;
}

export function CodexStepsParts({ parts }: CodexStepsPartsProps) {
  const steps = useMemo<StepView[]>(() => {
    const sourceParts = toVirtualCodexParts(parts);
    const buckets = new Map<StepKind, StepView>();

    for (const part of sourceParts) {
      if (isCommandExecutionPart(part)) {
        const input = asRecord(part.input);
        const output = asRecord(part.output);
        const state = asString(part.state) || "output-streaming";
        const command = asString(input.command) || "command";
        const outputText = asString(output.text);
        const status = asString(output.status);
        const summary = status ? `${command} (${status})` : command;

        const existing = buckets.get("action");
        const viewPart: StepPartView = {
          summary,
          detail: "commandExecution",
          state,
          provider: "codex",
          command,
          terminalOutput: outputText,
          terminalStreaming:
            state === "input-streaming" ||
            state === "input-available" ||
            state === "output-streaming",
        };

        if (!existing) {
          buckets.set("action", {
            id: "action",
            title: stepTitle("action"),
            status:
              state === "output-available" || state === "output-error"
                ? "completed"
                : "running",
            parts: [viewPart],
          });
        } else {
          if (existing.status !== "completed" && state === "output-available") {
            existing.status = "completed";
          }
          existing.parts.push(viewPart);
        }
        continue;
      }

      const metadata = asRecord(part.metadata);
      const output = asRecord(part.output);
      const input = asRecord(part.input);
      const detail = asRecord(output.detail);
      const fallbackDetail = asRecord(input.detail);
      const resolvedDetail = Object.keys(detail).length > 0 ? detail : fallbackDetail;

      const phase = asString(metadata.phase) || asString(output.phase) || asString(input.phase);
      const provider =
        asString(metadata.providerChunkType) ||
        asString(output.providerChunkType) ||
        asString(input.providerChunkType);
      const label =
        asString(metadata.label) ||
        asString(output.label) ||
        asString(input.label) ||
        "event";
      const state = asString(part.state) || "output-streaming";

      const kind = detectStepKind(phase, provider);
      const status: StepView["status"] = isCompleted(phase, provider, state)
        ? "completed"
        : "running";

      const actionText = extractAction(resolvedDetail);
      const text = extractText(resolvedDetail);
      const token = extractTokenSummary(resolvedDetail);
      const detailSummary = text || token || actionText || "";
      const summary = detailSummary ? `${label}: ${detailSummary}` : label;

      const existing = buckets.get(kind);
      if (!existing) {
        buckets.set(kind, {
          id: kind,
          title: stepTitle(kind),
          status,
          parts: [
            {
              summary,
              detail: phase || provider,
              state,
              provider,
            },
          ],
        });
      } else {
        if (existing.status !== "completed" && status === "completed") {
          existing.status = "completed";
        }
        const lastSummary = existing.parts[existing.parts.length - 1]?.summary;
        if (lastSummary !== summary) {
          existing.parts.push({
            summary,
            detail: phase || provider,
            state,
            provider,
          });
        }
      }
    }

    const order: StepKind[] = ["turn", "reasoning", "message", "action", "usage", "runtime"];
    return order
      .map((key) => buckets.get(key))
      .filter((step): step is StepView => Boolean(step));
  }, [parts]);

  if (!steps.length) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-300/90">
        Codex steps
      </p>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className="rounded border border-emerald-500/20 bg-black/20 px-2 py-1.5"
          >
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[11px] text-emerald-100">{step.title}</p>
              <span
                className={
                  step.status === "completed"
                    ? "font-mono text-[10px] text-emerald-300"
                    : "font-mono text-[10px] text-amber-300"
                }
              >
                {step.status}
              </span>
            </div>
            <div className="space-y-1">
              {step.parts.map((part, idx) => (
                <div key={`${step.id}:${idx}`} className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_72px] gap-2">
                    <span className="truncate font-mono text-[11px] text-emerald-100/95">
                      {part.summary}
                    </span>
                    <span className="truncate text-right font-mono text-[10px] text-emerald-300/80">
                      {part.state}
                    </span>
                  </div>
                  {part.command ? (
                    <Terminal
                      output={part.terminalOutput || ""}
                      isStreaming={Boolean(part.terminalStreaming)}
                      className="rounded border-emerald-500/20 bg-black text-emerald-100"
                    >
                      <TerminalHeader className="border-emerald-500/20 bg-black/70 px-2.5 py-1.5">
                        <TerminalTitle className="text-[10px] text-emerald-300/90">
                          $ {part.command}
                        </TerminalTitle>
                        <div className="flex items-center gap-1">
                          <TerminalStatus className="text-[10px] text-amber-300/90">
                            streaming
                          </TerminalStatus>
                          <TerminalActions>
                            <TerminalCopyButton className="size-6 text-emerald-300/80 hover:bg-emerald-500/10 hover:text-emerald-100" />
                          </TerminalActions>
                        </div>
                      </TerminalHeader>
                      <TerminalContent className="max-h-48 p-2.5 text-[11px]" />
                    </Terminal>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
