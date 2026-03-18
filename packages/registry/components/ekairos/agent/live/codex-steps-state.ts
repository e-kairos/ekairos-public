"use client";

import type { ContextEventForUI } from "@/components/ekairos/context/context";
import {
  asRecord,
  asString,
  parsePersistedCodexStreamChunk,
} from "@/lib/examples/reactors/codex/shared";

export type CodexReplayStatus =
  | "idle"
  | "loading"
  | "replaying"
  | "live"
  | "completed"
  | "error";

export type CodexStepView = {
  stepId: string;
  executionId: string | null;
  status: string;
  kind: string;
  streamId: string | null;
  streamClientId: string | null;
  streamStartedAt: string | null;
  streamFinishedAt: string | null;
  streamSize: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  storedParts: Array<Record<string, unknown>>;
  storedEvent: ContextEventForUI;
  preview: string;
};

export type CodexReplayedStepContent = {
  stepId: string;
  source: "stream" | "stored";
  event: ContextEventForUI;
  commandExecutions: Array<Record<string, unknown>>;
  metadata: {
    providerContextId: string | null;
    turnId: string | null;
    diff: string | null;
    tokenUsage: Record<string, unknown>;
    streamTrace: Record<string, unknown>;
  };
  trace: {
    events: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    summary: {
      eventCount: number;
      chunkCount: number;
      streamTraceTotalChunks: number;
      chunkTypes: Record<string, number>;
      providerChunkTypes: Record<string, number>;
    };
  } | null;
  rawChunks: Array<Record<string, unknown>>;
  storedParts: Array<Record<string, unknown>>;
};

export type CodexStepsController = {
  status: "bootstrapping" | "streaming" | "completed" | "error";
  contextId: string | null;
  executionId: string | null;
  selectedStepId: string | null;
  steps: CodexStepView[];
  replayStatus: CodexReplayStatus;
  replayByteOffset: number;
  currentEvent: ContextEventForUI | null;
  currentStoredParts: Array<Record<string, unknown>>;
  selectStep: (stepId: string) => void;
  restart: () => Promise<void>;
};

type CodexPersistedTree = {
  persistedEvents: ContextEventForUI[];
  persistedExecutions: Array<Record<string, unknown>>;
  persistedSteps: Array<Record<string, unknown>>;
  persistedParts: Array<Record<string, unknown>>;
  filteredSteps: Array<Record<string, unknown>>;
  filteredParts: Array<Record<string, unknown>>;
  persistedPartsByStep: Map<string, Array<Record<string, unknown>>>;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function sortContextEvents(events: ContextEventForUI[]) {
  const parseTs = (raw: unknown): number => {
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const ms = new Date(raw).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
  };

  return events.slice().sort((a, b) => {
    const aMs = parseTs(a.createdAt);
    const bMs = parseTs(b.createdAt);
    if (aMs !== bMs) return aMs - bMs;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function formatStoredStepContent(parts: Array<Record<string, unknown>>) {
  return parts
    .map((row) => {
      const part = asRecord(row.part);
      const type = asString(part.type) || asString(row.type) || "part";
      if (type === "codex-event" || type === "tool-turnMetadata") return "";
      const text =
        asString(part.text) ||
        asString(asRecord(part.output).text) ||
        asString(asRecord(part.input).command) ||
        asString(asRecord(part.output).status) ||
        JSON.stringify(part);
      return `${type}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function buildStoredStepEvent(params: {
  stepId: string;
  createdAt: string;
  status: string;
  storedParts: Array<Record<string, unknown>>;
}): ContextEventForUI {
  return {
    id: `codex-step:${params.stepId}:stored`,
    type: "output",
    channel: "web",
    createdAt: params.createdAt,
    status: params.status === "running" ? "pending" : "completed",
    content: {
      parts: params.storedParts,
    },
  };
}

export function extractCodexPersistedTree(
  persistedContext: Record<string, unknown> | null,
): CodexPersistedTree {
  const persistedEvents = sortContextEvents(
    Array.isArray(persistedContext?.items)
      ? (persistedContext.items as ContextEventForUI[])
      : [],
  );
  const persistedExecutions = Array.isArray(persistedContext?.executions)
    ? (persistedContext.executions as Array<Record<string, unknown>>)
    : [];
  const persistedSteps = persistedExecutions.flatMap((execution) => {
    const stepRows = Array.isArray(execution.steps)
      ? (execution.steps as Array<Record<string, unknown>>)
      : [];
    return stepRows.map<Record<string, unknown>>((step) => ({
      ...step,
      execution:
        step.execution && typeof step.execution === "object"
          ? step.execution
          : { id: execution.id },
    }));
  });
  const persistedParts = persistedSteps.flatMap((step) => {
    const partRows = Array.isArray(step.parts)
      ? (step.parts as Array<Record<string, unknown>>)
      : [];
    return partRows.map<Record<string, unknown>>((part) => ({
      ...part,
      step:
        part.step && typeof part.step === "object"
          ? part.step
          : { id: step.id },
    }));
  });

  const executionIds = new Set(
    persistedExecutions.map((row) => asString(row.id)).filter(Boolean),
  );
  const filteredSteps = persistedSteps.filter((row) =>
    executionIds.has(asString(asRecord(row.execution).id)),
  );
  const filteredStepIds = new Set(
    filteredSteps.map((row) => asString(row.id)).filter(Boolean),
  );
  const filteredParts = persistedParts.filter((row) =>
    filteredStepIds.has(asString(asRecord(row.step).id)),
  );

  const persistedPartsByStep = new Map<string, Array<Record<string, unknown>>>();
  for (const row of filteredParts) {
    const stepId = asString(asRecord(row.step).id);
    if (!stepId) continue;
    const bucket = persistedPartsByStep.get(stepId) ?? [];
    bucket.push(row);
    persistedPartsByStep.set(stepId, bucket);
  }

  return {
    persistedEvents,
    persistedExecutions,
    persistedSteps,
    persistedParts,
    filteredSteps,
    filteredParts,
    persistedPartsByStep,
  };
}

export function buildCodexStepViews(params: {
  filteredSteps: Array<Record<string, unknown>>;
  persistedPartsByStep: Map<string, Array<Record<string, unknown>>>;
}): CodexStepView[] {
  return params.filteredSteps
    .map((row) => {
      const stepId = asString(row.id);
      const storedPartRows = params.persistedPartsByStep.get(stepId) ?? [];
      const storedParts = storedPartRows
        .map((partRow) => asRecord(partRow.part))
        .filter((part) => Object.keys(part).length > 0);
      const createdAt = formatDate(row.createdAt) || nowIso();
      const status = asString(row.status) || "unknown";

      return {
        stepId,
        executionId: asString(asRecord(row.execution).id) || null,
        status,
        kind: asString(row.kind) || "-",
        streamId: asString(row.streamId) || null,
        streamClientId: asString(row.streamClientId) || null,
        streamStartedAt: formatDate(row.streamStartedAt),
        streamFinishedAt: formatDate(row.streamFinishedAt),
        streamSize: asFiniteNumber(asRecord(row.stream).size),
        createdAt: formatDate(row.createdAt),
        updatedAt: formatDate(row.updatedAt),
        storedParts,
        storedEvent: buildStoredStepEvent({
          stepId,
          createdAt,
          status,
          storedParts,
        }),
        preview: formatStoredStepContent(storedPartRows),
      };
    })
    .sort((a, b) => {
      const aCreatedAt = new Date(a.createdAt || 0).getTime();
      const bCreatedAt = new Date(b.createdAt || 0).getTime();
      if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
      return String(b.stepId).localeCompare(String(a.stepId));
    });
}

export async function consumePersistedCodexStepStream(params: {
  db: any;
  signal: AbortSignal;
  clientId?: string | null;
  streamId?: string | null;
  byteOffset?: number;
  onByteOffset?: (byteOffset: number) => void;
  onChunk?: (
    chunk: Record<string, unknown>,
    info: {
      parsedByteOffset: number;
      streamByteOffset: number;
    },
  ) => Promise<void> | void;
  onDone?: () => Promise<void> | void;
}) {
  const stream = params.db.streams.createReadStream({
    clientId: params.clientId || undefined,
    streamId: params.streamId || undefined,
    byteOffset: params.byteOffset ?? 0,
  });
  const reader = stream.getReader();
  const encoder = new TextEncoder();
  let nextByteOffset = params.byteOffset ?? 0;
  let parsedByteOffset = params.byteOffset ?? 0;
  let buffer = "";

  const handleAbort = () => {
    void reader.cancel().catch(() => {});
  };
  params.signal.addEventListener("abort", handleAbort, { once: true });

  try {
    while (!params.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        await params.onDone?.();
        break;
      }

      const raw = typeof value === "string" ? value : String(value ?? "");
      if (!raw) continue;

      nextByteOffset += encoder.encode(raw).length;
      params.onByteOffset?.(nextByteOffset);
      buffer += raw;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        parsedByteOffset += encoder.encode(`${line}\n`).length;
        await params.onChunk?.(parsePersistedCodexStreamChunk(trimmed), {
          parsedByteOffset,
          streamByteOffset: nextByteOffset,
        });
      }
    }

    const trailing = buffer.trim();
    if (trailing && !params.signal.aborted) {
      parsedByteOffset += encoder.encode(trailing).length;
      await params.onChunk?.(parsePersistedCodexStreamChunk(trailing), {
        parsedByteOffset,
        streamByteOffset: nextByteOffset,
      });
    }
  } finally {
    params.signal.removeEventListener("abort", handleAbort);
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}
