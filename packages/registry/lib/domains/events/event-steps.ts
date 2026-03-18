"use client";

import type { InstantReactWebDatabase } from "@instantdb/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSchema } from "@/instant.schema";

export const REACTOR_EVENT_PART_TYPE = "reactor-event";

export type ReactorReplayStatus =
  | "idle"
  | "loading"
  | "replaying"
  | "live"
  | "completed"
  | "error";

export type ReactorStreamChunk = {
  version: 1;
  at: string;
  sequence: number;
  chunkType: string;
  provider: string;
  providerChunkType?: string;
  actionRef?: string | null;
  label?: string;
  text?: string;
  data?: Record<string, unknown>;
};

export type EventStepView = {
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
  storedEvent: EventUiMessage;
  preview: string;
};

export type EventUiMessage = {
  id: string;
  type: string;
  channel: string;
  createdAt: string | Date;
  status?: string;
  content: { parts: any[] };
};

export type EventStepsController = {
  status: "bootstrapping" | "streaming" | "completed" | "error";
  contextId: string | null;
  executionId: string | null;
  selectedStepId: string | null;
  steps: EventStepView[];
  replayStatus: ReactorReplayStatus;
  replayByteOffset: number;
  currentEvent: EventUiMessage | null;
  currentStoredParts: Array<Record<string, unknown>>;
  selectStep: (stepId: string) => void;
  restart: () => Promise<void>;
};

export type EventDemoScenario = {
  id: string;
  title: string;
  subtitle: string;
  reactor: "scripted" | "ai-sdk" | "codex";
  prompt: string;
  chunks: Array<{
    delayMs: number;
    chunk: Omit<ReactorStreamChunk, "version" | "at" | "sequence">;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function makeUuid(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  return "00000000-0000-4000-8000-000000000000";
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function countBy<T extends string>(rows: Array<Record<string, unknown>>, key: T) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const label = asString(row[key]) || "unknown";
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
}

function sortEvents(events: EventUiMessage[]) {
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

function encodeReactorStreamChunk(chunk: ReactorStreamChunk) {
  return `${JSON.stringify(chunk)}\n`;
}

function parseReactorStreamChunk(value: string | Record<string, unknown>): ReactorStreamChunk {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const row = asRecord(parsed);
  return {
    version: 1,
    at: asString(row.at) || nowIso(),
    sequence: asFiniteNumber(row.sequence) ?? 0,
    chunkType: asString(row.chunkType) || "chunk.unknown",
    provider: asString(row.provider) || "unknown",
    providerChunkType: asString(row.providerChunkType) || undefined,
    actionRef: asString(row.actionRef) || undefined,
    label: asString(row.label) || undefined,
    text: asString(row.text) || undefined,
    data: Object.keys(asRecord(row.data)).length > 0 ? asRecord(row.data) : undefined,
  };
}

function formatStoredStepContent(parts: Array<Record<string, unknown>>) {
  return parts
    .map((row) => {
      const part = asRecord(row.part);
      const type = asString(part.type) || asString(row.type) || "part";
      if (type === "tool-turnMetadata") return "";
      if (type === "text") return asString(part.text);
      if (type === "reasoning") return asString(part.text);
      if (type === REACTOR_EVENT_PART_TYPE) return asString(asRecord(part.output).label);
      if (type.startsWith("tool-")) {
        return (
          asString(asRecord(part.output).text) ||
          asString(asRecord(part.output).status) ||
          asString(asRecord(part.input).actionRef)
        );
      }
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join("\n");
}

function buildStoredStepEvent(params: {
  stepId: string;
  createdAt: string;
  status: string;
  storedParts: Array<Record<string, unknown>>;
}): EventUiMessage {
  return {
    id: `event-step:${params.stepId}:stored`,
    type: "output",
    channel: "web",
    createdAt: params.createdAt,
    status: params.status === "running" ? "pending" : "completed",
    content: { parts: params.storedParts },
  };
}

export function buildReactorReplayEvent(params: {
  eventId: string;
  createdAt: string;
  chunks: Array<Record<string, unknown>>;
}) {
  const chunks = params.chunks.map((chunk) => parseReactorStreamChunk(chunk));
  const textSegments: Array<{ sequence: number; text: string }> = [];
  const reasoningSegments: Array<{ sequence: number; text: string }> = [];
  const actionParts: Array<{ sequence: number; part: Record<string, unknown> }> = [];
  let lastTokenUsage: Record<string, unknown> = {};
  let provider = "";
  let completed = false;
  let completedSequence = 0;
  let completedAt = "";

  for (const chunk of chunks) {
    provider = chunk.provider || provider;
    if (chunk.chunkType === "chunk.text_delta" && chunk.text) {
      textSegments.push({ sequence: chunk.sequence, text: chunk.text });
    }
    if (chunk.chunkType === "chunk.reasoning_delta" && chunk.text) {
      reasoningSegments.push({ sequence: chunk.sequence, text: chunk.text });
    }
    if (
      (chunk.chunkType === "chunk.action_input_available" ||
        chunk.chunkType === "chunk.action_output_available" ||
        chunk.chunkType === "chunk.action_output_error") &&
      chunk.actionRef
    ) {
      actionParts.push({
        sequence: chunk.sequence,
        part: {
          type: "tool-reactorAction",
          toolName: "reactorAction",
          toolCallId: chunk.actionRef,
          state:
            chunk.chunkType === "chunk.action_output_error"
              ? "output-error"
              : chunk.chunkType === "chunk.action_output_available"
                ? "output-available"
                : "input-available",
          input: {
            actionRef: chunk.actionRef,
            provider: chunk.provider,
            providerChunkType: chunk.providerChunkType,
          },
          output: {
            label: chunk.label || null,
            text: chunk.text || null,
          },
          metadata: {
            sequence: chunk.sequence,
            at: chunk.at,
          },
        },
      });
    }
    if (chunk.chunkType === "chunk.response_metadata") {
      lastTokenUsage = asRecord(chunk.data?.tokenUsage);
    }
    if (chunk.chunkType === "chunk.finish") {
      completed = true;
      completedSequence = chunk.sequence;
      completedAt = chunk.at;
    }
  }

  const parts: Array<{ sequence: number; part: Record<string, unknown> }> = [];
  if (reasoningSegments.length > 0) {
    parts.push({
      sequence: reasoningSegments[reasoningSegments.length - 1]!.sequence,
      part: {
        type: "reasoning",
        text: reasoningSegments.map((row) => row.text).join(""),
      },
    });
  }
  if (textSegments.length > 0) {
    parts.push({
      sequence: textSegments[textSegments.length - 1]!.sequence,
      part: {
        type: "text",
        text: textSegments.map((row) => row.text).join(""),
      },
    });
  }
  parts.push(...actionParts);
  parts.push({
    sequence: completed ? completedSequence : chunks.length + 1,
    part: {
      type: "tool-turnMetadata",
      toolName: "turnMetadata",
      toolCallId: params.eventId,
      state: completed ? "output-available" : "output-streaming",
      input: {},
      output: {
        provider: provider || null,
        tokenUsage: lastTokenUsage,
        streamTrace: {
          totalChunks: chunks.length,
          chunkTypes: countBy(chunks as any, "chunkType"),
          providerChunkTypes: countBy(chunks as any, "providerChunkType"),
          chunks,
        },
      },
      metadata: {
        source: "reactor.stream.replay",
        sequence: completed ? completedSequence : chunks.length + 1,
        at: completed ? completedAt : "",
      },
    },
  });

  const sorted = parts.sort((a, b) => a.sequence - b.sequence).map((entry) => entry.part);
  return {
    event: {
      id: params.eventId,
      type: "output",
      channel: "web",
      createdAt: params.createdAt,
      status: completed ? "completed" : "pending",
      content: { parts: sorted },
    } satisfies EventUiMessage,
    chunks,
    isCompleted: completed,
  };
}

function extractPersistedTree(persistedContext: Record<string, unknown> | null) {
  const persistedEvents = sortEvents(
    Array.isArray(persistedContext?.items) ? (persistedContext.items as EventUiMessage[]) : [],
  );
  const persistedExecutions = Array.isArray(persistedContext?.executions)
    ? (persistedContext.executions as Array<Record<string, unknown>>)
    : [];
  const persistedSteps = persistedExecutions.flatMap((execution) => {
    const stepRows = Array.isArray((execution as any).steps)
      ? ((execution as any).steps as Array<Record<string, unknown>>)
      : [];
    return stepRows.map((step) => ({
      ...step,
      execution:
        step.execution && typeof step.execution === "object"
          ? step.execution
          : { id: execution.id },
    }));
  });
  const persistedParts = persistedSteps.flatMap((step: Record<string, unknown>) => {
    const partRows = Array.isArray(step.parts)
      ? (step.parts as Array<Record<string, unknown>>)
      : [];
    return partRows.map((part) => ({
      ...part,
      step: part.step && typeof part.step === "object" ? part.step : { id: step.id },
    }));
  });

  const executionIds = new Set(persistedExecutions.map((row) => asString(row.id)).filter(Boolean));
  const filteredSteps = persistedSteps.filter((row) =>
    executionIds.has(asString(asRecord(row.execution).id)),
  );
  const filteredStepIds = new Set(
    filteredSteps
      .map((row) => asString((row as Record<string, unknown>).id))
      .filter(Boolean),
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
    filteredSteps,
    persistedPartsByStep,
  };
}

function buildStepViews(params: {
  filteredSteps: Array<Record<string, unknown>>;
  persistedPartsByStep: Map<string, Array<Record<string, unknown>>>;
}): EventStepView[] {
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

async function consumePersistedEventStepStream(params: {
  db: InstantReactWebDatabase<AppSchema>;
  signal: AbortSignal;
  clientId?: string | null;
  streamId?: string | null;
  byteOffset?: number;
  onByteOffset?: (byteOffset: number) => void;
  onChunk?: (
    chunk: ReactorStreamChunk,
    info: { parsedByteOffset: number; streamByteOffset: number },
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
        await params.onChunk?.(parseReactorStreamChunk(trimmed), {
          parsedByteOffset,
          streamByteOffset: nextByteOffset,
        });
      }
    }
  } finally {
    params.signal.removeEventListener("abort", handleAbort);
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

export function useEventStepsController(params: {
  db: InstantReactWebDatabase<AppSchema>;
  contextId: string | null;
  restart: () => Promise<void>;
  statusOverride?: EventStepsController["status"] | null;
}): EventStepsController {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepReplayVersion, setStepReplayVersion] = useState(0);
  const [replayStatus, setReplayStatus] = useState<ReactorReplayStatus>("idle");
  const [replayByteOffset, setReplayByteOffset] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<EventUiMessage | null>(null);
  const replayAbortControllerRef = useRef<AbortController | null>(null);

  const contextQuery = params.db.useQuery(
    params.contextId
      ? ({
          event_contexts: {
            $: { where: { id: params.contextId as any }, limit: 1 },
            executions: {
              $: { order: { createdAt: "desc" }, limit: 50 },
              steps: {
                $: { order: { createdAt: "asc" }, limit: 500 },
                stream: {},
                parts: { $: { order: { idx: "asc" }, limit: 1000 } },
              },
            },
          },
        } as any)
      : null,
  );

  const persistedContext = useMemo(() => {
    const rows = ((contextQuery as any)?.data?.event_contexts ?? []) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  }, [contextQuery]);

  const persistedTree = useMemo(() => extractPersistedTree(persistedContext), [persistedContext]);
  const steps = useMemo(
    () =>
      buildStepViews({
        filteredSteps: persistedTree.filteredSteps,
        persistedPartsByStep: persistedTree.persistedPartsByStep,
      }),
    [persistedTree.filteredSteps, persistedTree.persistedPartsByStep],
  );
  const selectedStep = useMemo(
    () => steps.find((step) => step.stepId === selectedStepId) ?? null,
    [selectedStepId, steps],
  );

  useEffect(() => {
    if (steps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && steps.some((step) => step.stepId === selectedStepId)) return;
    setSelectedStepId(steps[0]?.stepId ?? null);
  }, [selectedStepId, steps]);

  useEffect(() => {
    replayAbortControllerRef.current?.abort();
    replayAbortControllerRef.current = null;
    setReplayByteOffset(0);

    if (!selectedStep) {
      setReplayStatus("idle");
      setCurrentEvent(null);
      return;
    }

    if (!selectedStep.streamClientId && !selectedStep.streamId) {
      setCurrentEvent(selectedStep.storedEvent);
      setReplayStatus("completed");
      return;
    }

    const abortController = new AbortController();
    replayAbortControllerRef.current = abortController;
    const replayChunks: Array<Record<string, unknown>> = [];
    setReplayStatus("loading");
    setCurrentEvent(null);

    void (async () => {
      try {
        await consumePersistedEventStepStream({
          db: params.db,
          signal: abortController.signal,
          clientId: selectedStep.streamClientId,
          streamId: selectedStep.streamId,
          onByteOffset: (byteOffset) => setReplayByteOffset(byteOffset),
          onChunk: async (chunk) => {
            replayChunks.push(chunk);
            const replay = buildReactorReplayEvent({
              eventId: `event-step-replay:${selectedStep.stepId}:${stepReplayVersion}`,
              createdAt: selectedStep.streamStartedAt || selectedStep.createdAt || nowIso(),
              chunks: replayChunks,
            });
            setCurrentEvent(replay.event);
            setReplayStatus(selectedStep.status === "running" ? "live" : "replaying");
          },
          onDone: () => {
            if (!abortController.signal.aborted) {
              setReplayStatus("completed");
            }
          },
        });
      } finally {
        if (replayAbortControllerRef.current === abortController) {
          replayAbortControllerRef.current = null;
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [
    params.db,
    selectedStep?.createdAt,
    selectedStep?.status,
    selectedStep?.stepId,
    selectedStep?.streamClientId,
    selectedStep?.streamId,
    selectedStep?.streamStartedAt,
    stepReplayVersion,
  ]);

  const status = useMemo<EventStepsController["status"]>(() => {
    if (params.statusOverride) return params.statusOverride;
    if (!params.contextId) return "bootstrapping";
    if (selectedStep?.status === "running" || replayStatus === "loading" || replayStatus === "live") {
      return "streaming";
    }
    if (steps.length > 0) return "completed";
    return "bootstrapping";
  }, [params.contextId, params.statusOverride, replayStatus, selectedStep?.status, steps.length]);

  const executionId = selectedStep?.executionId ?? steps[0]?.executionId ?? null;

  return useMemo(
    () => ({
      status,
      contextId: params.contextId,
      executionId,
      selectedStepId,
      steps,
      replayStatus,
      replayByteOffset,
      currentEvent: currentEvent ?? selectedStep?.storedEvent ?? null,
      currentStoredParts: selectedStep?.storedParts ?? [],
      selectStep: (stepId: string) => {
        setSelectedStepId(stepId);
        setStepReplayVersion((current) => current + 1);
      },
      restart: params.restart,
    }),
    [
      currentEvent,
      executionId,
      params.contextId,
      params.restart,
      replayByteOffset,
      replayStatus,
      selectedStep,
      selectedStepId,
      status,
      steps,
    ],
  );
}

export function createCanonicalReactorChunk(
  params: Omit<ReactorStreamChunk, "version" | "at" | "sequence"> & {
    sequence: number;
    at?: string;
  },
): ReactorStreamChunk {
  return {
    version: 1,
    at: params.at ?? nowIso(),
    sequence: params.sequence,
    chunkType: params.chunkType,
    provider: params.provider,
    providerChunkType: params.providerChunkType,
    actionRef: params.actionRef,
    label: params.label,
    text: params.text,
    data: params.data,
  };
}

export async function createDemoStepStream(params: {
  db: InstantReactWebDatabase<AppSchema>;
  executionId: string;
  stepId: string;
}) {
  const startedAt = new Date();
  const streamClientId = `event-step:${params.stepId}`;
  const writeStream = params.db.streams.createWriteStream({ clientId: streamClientId });
  const writer = writeStream.getWriter();
  const streamId = await writeStream.streamId();

  await params.db.transact([
    params.db.tx.event_steps[params.stepId]
      .update({
        streamId,
        streamClientId,
        streamStartedAt: startedAt,
        streamFinishedAt: null,
        streamAbortReason: null,
        updatedAt: startedAt,
      })
      .link({ stream: streamId }),
    params.db.tx.event_executions[params.executionId]
      .update({
        activeStreamId: streamId,
        activeStreamClientId: streamClientId,
        lastStreamId: streamId,
        lastStreamClientId: streamClientId,
        updatedAt: startedAt,
      })
      .link({ activeStream: streamId, lastStream: streamId }),
  ] as any);

  return {
    writer,
    streamId,
    streamClientId,
    write(chunk: ReactorStreamChunk) {
      return writer.write(encodeReactorStreamChunk(chunk));
    },
  };
}
