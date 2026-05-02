"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AppendArgs,
  ContextEventForUI,
  ContextFirstLevel,
  ContextStepRuntime,
  ContextStepForUI,
  ContextStepStreamReaderInfo,
  ContextStatus,
  ContextValue,
  SendStatus,
  UseContextOptions,
  UseContextState,
  UseContextStateHook,
} from "./react.types";
import { INPUT_TEXT_ITEM_TYPE } from "./react.types";
import {
  buildContextStepViews,
  buildEventStepsIndex,
  buildLiveEventFromStepChunks,
  consumePersistedContextStepStream,
  extractPersistedContextTree,
  isUserEvent,
} from "./react.step-stream";
import {
  getActionPartInfo,
  getReasoningState,
  normalizeContextEventParts,
} from "./react.context-event-parts";

const DEFAULT_STREAM_CHUNK_DELAY_MS =
  process.env.NODE_ENV === "development" ? 80 : 0;
const STREAM_DEBUG_RAW_SAMPLE_LIMIT = 50;

type EphemeralEvent = ContextEventForUI & { __contextId: string | null };

type ActiveStepStreamReader = {
  abortController: AbortController;
  db: any;
  streamKey: string;
  chunks: Array<Record<string, unknown>>;
  rawLines: string[];
  byteOffset: number;
  streamByteOffset: number;
  startedAt: string;
};

type StepReaders = Map<string, ActiveStepStreamReader>;

function randomUuidV4(): string {
  const anyCrypto = (globalThis as any)?.crypto;
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  if (anyCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    anyCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .slice(1);
  return `${s4()}${s4()}-${s4()}-4${s4().slice(1)}-${(
    (8 + Math.random() * 4) |
    0
  ).toString(16)}${s4().slice(1)}-${s4()}${s4()}${s4()}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeContextStatus(value: unknown): ContextStatus {
  const raw = asText(value);
  if (raw === "closed") return "closed";
  if (raw === "streaming" || raw === "open_streaming") return "open_streaming";
  return "open_idle";
}

function firstLinkedRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function toPublicContextFirstLevel(value: unknown): ContextFirstLevel | null {
  const record = asRecord(value);
  const contextId = asText(record?.id);
  if (!record || !contextId) return null;

  const currentExecutionRecord = firstLinkedRecord(record.currentExecution);
  const currentExecutionId = asText(currentExecutionRecord?.id);

  return {
    id: contextId,
    key: asText(record.key) || null,
    name: asText(record.name) || null,
    status: normalizeContextStatus(record.status),
    content: record.content,
    currentExecution: currentExecutionId
      ? {
          id: currentExecutionId,
          status: asText(currentExecutionRecord?.status) || null,
        }
      : null,
  };
}

function messageToEphemeralEvent(
  message: { id: string; parts: any[] },
  ctx: string | null,
): EphemeralEvent {
  return {
    __contextId: ctx,
    id: String(message.id),
    type: INPUT_TEXT_ITEM_TYPE,
    channel: "web",
    createdAt: new Date().toISOString(),
    content: { parts: Array.isArray(message.parts) ? message.parts : [] },
  };
}

function partsToSendPayload(parts: any[]) {
  return [
    {
      id: randomUuidV4(),
      role: "user" as const,
      parts: Array.isArray(parts) ? parts : [],
    },
  ];
}

function mergeEvents(params: {
  persisted: ContextEventForUI[];
  optimistic: EphemeralEvent[];
  currentContextId: string | null;
}) {
  const byId = new Map<string, ContextEventForUI>();
  for (const event of params.persisted) {
    byId.set(String(event.id), event);
  }

  const merged = [...params.persisted];
  for (const event of params.optimistic) {
    const belongsToActive =
      String(event.__contextId) === String(params.currentContextId) ||
      (event.__contextId == null && params.currentContextId != null);
    if (!belongsToActive) continue;
    if (byId.has(String(event.id))) continue;
    merged.push(event);
  }

  return merged;
}

function stepStreamKey(step: ContextStepRuntime) {
  if (step.streamId) return `stream:${step.streamId}`;
  if (step.streamClientId) return `client:${step.streamClientId}`;
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

function defaultStreamReaderInfo(step: ContextStepRuntime): ContextStepStreamReaderInfo {
  const streamKey = stepStreamKey(step);
  const hasStream = Boolean(streamKey);
  const isRunning = step.status === "running";
  const isFinished = Boolean(step.streamFinishedAt || step.stream?.done === true);

  return {
    status: !hasStream
      ? isRunning
        ? "missing_stream_identity"
        : "no_stream_identity"
      : isRunning
        ? "waiting_for_reader"
        : isFinished
          ? "not_reading_finished_step"
          : "not_reading_step",
    streamKey: streamKey || null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    attempts: 0,
    chunkCount: 0,
    byteOffset: 0,
    streamByteOffset: 0,
    lastChunkType: null,
    lastSequence: null,
    lastError: null,
    reason: !hasStream
      ? "No streamId or streamClientId is present on event_steps."
      : isRunning
        ? "Reader has not reported activity yet."
      : isFinished
          ? "Step is finished and no replay reader is attached."
          : "Step is not running.",
    rawChunkSampleOffset: 0,
    rawChunkSample: [],
    rawLineSample: [],
  };
}

function streamDebugSample<T>(items: T[]) {
  const offset = Math.max(0, items.length - STREAM_DEBUG_RAW_SAMPLE_LIMIT);
  return {
    offset,
    sample: items.slice(offset),
  };
}

function streamReaderRawDebug(active: ActiveStepStreamReader) {
  const chunkSample = streamDebugSample(active.chunks);
  const lineSample = streamDebugSample(active.rawLines);
  return {
    rawChunkSampleOffset: chunkSample.offset,
    rawChunkSample: chunkSample.sample,
    rawLineSample: lineSample.sample,
  };
}

function abortAllStepReaders(readers: StepReaders) {
  for (const active of readers.values()) {
    active.abortController.abort();
  }
  readers.clear();
}

function isAbortLikeError(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return true;
  const record = asRecord(error);
  return (
    record?.name === "AbortError" ||
    String(record?.message ?? "").toLowerCase().includes("abort")
  );
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function normalizeStreamChunkDelayMs(value: unknown) {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, 1000);
}

function normalizePartsForStep(parts: Array<Record<string, unknown>>) {
  return normalizeContextEventParts(parts)
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part));
}

function syncContextStepStreamReaders(params: {
  db: any;
  steps: ContextStepRuntime[];
  streamChunkDelayMs: number;
  readers: StepReaders;
  setStreamReaderInfoByStepId: React.Dispatch<
    React.SetStateAction<Record<string, ContextStepStreamReaderInfo>>
  >;
  setLiveEventsByStepId: React.Dispatch<
    React.SetStateAction<Record<string, ContextEventForUI>>
  >;
  setTurnSubstateKey: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const desired = new Map<string, { streamKey: string; step: ContextStepRuntime }>();
  for (const step of params.steps) {
    const streamKey = stepStreamKey(step);
    if (step.status === "running" && !streamKey) {
      params.setStreamReaderInfoByStepId((prev) => ({
        ...prev,
        [step.stepId]: defaultStreamReaderInfo(step),
      }));
      continue;
    }
    if (step.status !== "running") continue;
    if (!streamKey) continue;
    desired.set(step.stepId, { streamKey, step });
  }

  for (const [stepId, active] of params.readers.entries()) {
    const next = desired.get(stepId);
    if (!next || next.streamKey !== active.streamKey || active.db !== params.db) {
      active.abortController.abort();
      params.readers.delete(stepId);
      params.setStreamReaderInfoByStepId((prev) => ({
        ...prev,
        [stepId]: {
          ...(prev[stepId] ?? {
            streamKey: active.streamKey,
            startedAt: active.startedAt,
            attempts: 0,
            chunkCount: active.chunks.length,
            byteOffset: active.byteOffset,
            streamByteOffset: active.streamByteOffset,
          }),
          status: "aborted",
          streamKey: active.streamKey,
          updatedAt: nowIso(),
          completedAt: nowIso(),
          chunkCount: active.chunks.length,
          byteOffset: active.byteOffset,
          streamByteOffset: active.streamByteOffset,
          reason: next
            ? "Stream key or db instance changed."
            : "Step is no longer running; persisted parts are the source of truth.",
          lastChunkType: prev[stepId]?.lastChunkType ?? null,
          lastSequence: prev[stepId]?.lastSequence ?? null,
          lastError: prev[stepId]?.lastError ?? null,
          ...streamReaderRawDebug(active),
        },
      }));
    }
  }

  for (const [stepId, next] of desired.entries()) {
    if (params.readers.has(stepId)) continue;

    const abortController = new AbortController();
    const active: ActiveStepStreamReader = {
      abortController,
      db: params.db,
      streamKey: next.streamKey,
      chunks: [],
      rawLines: [],
      byteOffset: 0,
      streamByteOffset: 0,
      startedAt: nowIso(),
    };
    params.readers.set(stepId, active);
    params.setStreamReaderInfoByStepId((prev) => ({
      ...prev,
      [stepId]: {
        status: "starting",
        streamKey: next.streamKey,
        startedAt: active.startedAt,
        updatedAt: active.startedAt,
        completedAt: null,
        attempts: 0,
        chunkCount: 0,
        byteOffset: 0,
        streamByteOffset: 0,
        lastChunkType: null,
        lastSequence: null,
        lastError: null,
        reason: "Reader scheduled for running step.",
        rawChunkSampleOffset: 0,
        rawChunkSample: [],
        rawLineSample: [],
      },
    }));

    void runContextStepStreamReader({
      db: params.db,
      step: next.step,
      readers: params.readers,
      active,
      streamChunkDelayMs: params.streamChunkDelayMs,
      setStreamReaderInfoByStepId: params.setStreamReaderInfoByStepId,
      setLiveEventsByStepId: params.setLiveEventsByStepId,
      setTurnSubstateKey: params.setTurnSubstateKey,
    });
  }
}

async function runContextStepStreamReader(params: {
  db: any;
  step: ContextStepRuntime;
  readers: StepReaders;
  active: ActiveStepStreamReader;
  streamChunkDelayMs: number;
  setStreamReaderInfoByStepId: React.Dispatch<
    React.SetStateAction<Record<string, ContextStepStreamReaderInfo>>
  >;
  setLiveEventsByStepId: React.Dispatch<
    React.SetStateAction<Record<string, ContextEventForUI>>
  >;
  setTurnSubstateKey: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { active, step } = params;
  const signal = active.abortController.signal;

  try {
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt += 1) {
      try {
        params.setStreamReaderInfoByStepId((prev) => ({
          ...prev,
          [step.stepId]: {
            ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
            status: "reading",
            streamKey: active.streamKey,
            startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
            updatedAt: nowIso(),
            attempts: attempt + 1,
            chunkCount: active.chunks.length,
            byteOffset: active.byteOffset,
            streamByteOffset: active.streamByteOffset,
            lastError: null,
            reason: "createReadStream is active.",
            ...streamReaderRawDebug(active),
          },
        }));
        await consumePersistedContextStepStream({
          db: params.db,
          signal,
          byteOffset: active.byteOffset,
          clientId: step.streamClientId,
          streamId: step.streamId,
          onByteOffset: (byteOffset) => {
            active.byteOffset = byteOffset;
            params.setStreamReaderInfoByStepId((prev) => ({
              ...prev,
              [step.stepId]: {
                ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
                status: "reading",
                streamKey: active.streamKey,
                startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
                updatedAt: nowIso(),
                attempts: attempt + 1,
                chunkCount: active.chunks.length,
                byteOffset,
                streamByteOffset: active.streamByteOffset,
                reason: "Read stream byte offset advanced.",
                ...streamReaderRawDebug(active),
              },
            }));
          },
          onChunk: async (chunk, info) => {
            const current = params.readers.get(step.stepId);
            if (current !== active) return;
            active.byteOffset = info.parsedByteOffset;
            active.streamByteOffset = info.streamByteOffset;
            active.chunks.push(chunk);
            active.rawLines.push(info.rawLine);
            const chunkRecord = asRecord(chunk) ?? {};
            const rawDebug = streamReaderRawDebug(active);

            const liveEvent = buildLiveEventFromStepChunks({
              eventId: `context-step-live:${step.stepId}`,
              createdAt:
                step.streamStartedAt ||
                step.streamFinishedAt ||
                new Date().toISOString(),
              chunks: active.chunks,
            });
            params.setLiveEventsByStepId((prev) => ({
              ...prev,
              [step.stepId]: liveEvent,
            }));
            params.setStreamReaderInfoByStepId((prev) => ({
              ...prev,
              [step.stepId]: {
                ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
                status: "reading",
                streamKey: active.streamKey,
                startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
                updatedAt: nowIso(),
                completedAt: null,
                attempts: attempt + 1,
                chunkCount: active.chunks.length,
                byteOffset: info.parsedByteOffset,
                streamByteOffset: info.streamByteOffset,
                lastChunkType: asText(chunkRecord.chunkType) || null,
                lastSequence:
                  typeof chunkRecord.sequence === "number"
                    ? chunkRecord.sequence
                    : Number.isFinite(Number(chunkRecord.sequence))
                      ? Number(chunkRecord.sequence)
                      : null,
                lastError: null,
                reason: "Chunk consumed from resumable stream.",
                ...rawDebug,
              },
            }));
            params.setTurnSubstateKey("actions");
            await sleep(params.streamChunkDelayMs, signal);
          },
          onDone: async () => {
            params.setStreamReaderInfoByStepId((prev) => ({
              ...prev,
              [step.stepId]: {
                ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
                status: "completed",
                streamKey: active.streamKey,
                startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
                updatedAt: nowIso(),
                completedAt: nowIso(),
                attempts: attempt + 1,
                chunkCount: active.chunks.length,
                byteOffset: active.byteOffset,
                streamByteOffset: active.streamByteOffset,
                reason: "Readable stream ended.",
                ...streamReaderRawDebug(active),
              },
            }));
            params.setTurnSubstateKey((current) =>
              current === "actions" ? null : current,
            );
          },
        });
        break;
      } catch (error) {
        if (isAbortLikeError(error, signal)) return;
        params.setStreamReaderInfoByStepId((prev) => ({
          ...prev,
          [step.stepId]: {
            ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
            status: "failed",
            streamKey: active.streamKey,
            startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
            updatedAt: nowIso(),
            completedAt: null,
            attempts: attempt + 1,
            chunkCount: active.chunks.length,
            byteOffset: active.byteOffset,
            streamByteOffset: active.streamByteOffset,
            lastError: error instanceof Error ? error.message : String(error),
            reason: "createReadStream threw while reading.",
            ...streamReaderRawDebug(active),
          },
        }));
        console.warn("[ekairos:context-stream] step stream read failed", {
          stepId: step.stepId,
          attempt: attempt + 1,
          error,
        });
        await sleep(500 * (attempt + 1), signal);
      }
    }
  } finally {
    const current = params.readers.get(step.stepId);
    if (current === active) {
      params.readers.delete(step.stepId);
      if (signal.aborted) {
        params.setStreamReaderInfoByStepId((prev) => ({
          ...prev,
          [step.stepId]: {
            ...(prev[step.stepId] ?? defaultStreamReaderInfo(step)),
            status: "aborted",
            streamKey: active.streamKey,
            startedAt: prev[step.stepId]?.startedAt ?? active.startedAt,
            updatedAt: nowIso(),
            completedAt: nowIso(),
            attempts: prev[step.stepId]?.attempts ?? 0,
            chunkCount: active.chunks.length,
            byteOffset: active.byteOffset,
            streamByteOffset: active.streamByteOffset,
            reason: "Reader abort signal was triggered.",
            ...streamReaderRawDebug(active),
          },
        }));
      }
    }
  }
}

function getLiveStepParts(event: ContextEventForUI | undefined) {
  if (!event) return [];
  return normalizePartsForStep(
    Array.isArray(event.content?.parts) ? event.content.parts : [],
  );
}

type StepPartGroup = {
  key: string;
  index: number;
  parts: Array<Record<string, unknown>>;
};

function stepPartGroupKey(part: Record<string, unknown>, index: number) {
  const action = getActionPartInfo(part);
  if (action) return `action:${action.actionCallId}`;

  const type = asText(part.type) || "part";
  if (type === "reasoning") return "reasoning";
  if (type === "message") return "message";
  if (type === "source") return "source";
  return `${type}:${index}`;
}

function groupStepParts(parts: Array<Record<string, unknown>>) {
  const groups = new Map<string, StepPartGroup>();
  parts.forEach((part, index) => {
    const key = stepPartGroupKey(part, index);
    const group = groups.get(key);
    if (group) {
      group.parts.push(part);
      return;
    }
    groups.set(key, { key, index, parts: [part] });
  });

  return [...groups.values()].sort((a, b) => a.index - b.index);
}

export function mergeContextStepPartsForUI(params: {
  persistedParts: Array<Record<string, unknown>>;
  liveParts: Array<Record<string, unknown>>;
  stepStatus?: string | null;
}) {
  const persistedParts = normalizePartsForStep(params.persistedParts);
  const liveParts = normalizePartsForStep(params.liveParts);
  if (params.stepStatus && params.stepStatus !== "running") return persistedParts;
  if (liveParts.length === 0) return persistedParts;
  if (persistedParts.length === 0) return liveParts;

  const persistedGroups = groupStepParts(persistedParts);
  const liveGroups = groupStepParts(liveParts);
  const mergedGroups = new Map<string, StepPartGroup & { sortIndex: number }>();

  for (const group of persistedGroups) {
    mergedGroups.set(group.key, {
      ...group,
      sortIndex: group.index * 2,
    });
  }

  for (const liveGroup of liveGroups) {
    const persistedGroup = mergedGroups.get(liveGroup.key);
    if (!persistedGroup) {
      mergedGroups.set(liveGroup.key, {
        ...liveGroup,
        sortIndex: liveGroup.index * 2 + 1,
      });
      continue;
    }

    if (partGroupHasTerminalPersistedPart(persistedGroup.parts)) continue;

    mergedGroups.set(liveGroup.key, {
      ...liveGroup,
      sortIndex: persistedGroup.sortIndex,
    });
  }

  return [...mergedGroups.values()]
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .flatMap((group) => group.parts);
}

function partGroupHasTerminalPersistedPart(parts: Array<Record<string, unknown>>) {
  return parts.some((part) => {
    const action = getActionPartInfo(part);
    if (action) return action.status === "completed" || action.status === "failed";

    const type = asText(part.type);
    if (type === "reasoning") {
      const state = getReasoningState(part).toLowerCase();
      return (
        state === "done" ||
        state === "completed" ||
        state === "complete" ||
        state === "finished"
      );
    }

    return true;
  });
}

function withLiveStepParts(params: {
  step: ContextStepRuntime;
  liveEvent?: ContextEventForUI;
}) {
  if (!params.liveEvent) return params.step;
  if (params.step.status !== "running") return params.step;

  const liveParts = getLiveStepParts(params.liveEvent);
  const mergedParts = mergeContextStepPartsForUI({
    persistedParts: params.step.parts,
    liveParts,
    stepStatus: params.step.status,
  });

  return {
    ...params.step,
    status:
      params.step.status === "running" && params.liveEvent.status !== "completed"
        ? "running"
        : params.step.status,
    parts: mergedParts,
  };
}

function toPublicStep(step: ContextStepRuntime): ContextStepForUI {
  return {
    stepId: step.stepId,
    executionId: step.executionId,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
    status: step.status,
    iteration: step.iteration,
    parts: step.parts,
  };
}

const useDefaultState: UseContextStateHook = (db, { contextId, contextKey }) => {
  const contextRes = db.useQuery(
    contextId || contextKey
      ? ({
          event_contexts: {
            $: {
              where: contextId
                ? { id: contextId as any }
                : { key: contextKey as any },
              limit: 1,
            },
            items: {
              $: { order: { createdAt: "asc" } },
            },
            currentExecution: {},
            executions: {
              $: { order: { createdAt: "desc" }, limit: 50 },
              trigger: {},
              reaction: {},
              items: {
                $: { order: { createdAt: "asc" } },
              },
              steps: {
                $: { order: { createdAt: "asc" }, limit: 500 },
                stream: {},
                parts: {
                  $: { order: { idx: "asc" }, limit: 1000 },
                },
              },
            },
          },
        } as any)
      : null,
  );

  const ctx = (contextRes as any)?.data?.event_contexts?.[0] ?? null;
  const raw = (ctx?.items ?? []) as ContextEventForUI[] | undefined;

  return {
    context: ctx,
    contextStatus: normalizeContextStatus(ctx?.status),
    events: Array.isArray(raw) ? raw : [],
  } satisfies UseContextState;
};

export function useContext(db: any, opts: UseContextOptions): ContextValue {
  const {
    apiUrl,
    initialContextId,
    contextKey,
    onContextUpdate,
    prepareAppendArgs,
    prepareRequestBody,
    streamChunkDelayMs = DEFAULT_STREAM_CHUNK_DELAY_MS,
    state: useStateImpl = useDefaultState,
  } = opts;
  const normalizedStreamChunkDelayMs = normalizeStreamChunkDelayMs(streamChunkDelayMs);

  const [contextId, setContextId] = useState<string | null>(initialContextId || null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticEvents, setOptimisticEvents] = useState<EphemeralEvent[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [liveEventsByStepId, setLiveEventsByStepId] = useState<Record<string, ContextEventForUI>>(
    {},
  );
  const [streamReaderInfoByStepId, setStreamReaderInfoByStepId] = useState<
    Record<string, ContextStepStreamReaderInfo>
  >({});

  const selectedContextIdRef = useRef<string | null>(initialContextId || null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const stepReadersRef = useRef<StepReaders>(new Map());

  useEffect(() => {
    setContextId(initialContextId || null);
  }, [initialContextId]);

  useEffect(() => {
    selectedContextIdRef.current = contextId;
  }, [contextId]);

  const handleContextUpdate = useCallback(
    (nextId: string) => {
      setContextId(nextId);
      onContextUpdate?.(nextId);
    },
    [onContextUpdate],
  );

  const { context } = useStateImpl(db, {
    contextId,
    contextKey,
  });
  const publicContext = useMemo(
    () => toPublicContextFirstLevel(context),
    [context],
  );

  useEffect(() => {
    const nextId = asText((context as any)?.id);
    if (!nextId) return;
    if (nextId === contextId) return;
    handleContextUpdate(nextId);
  }, [context, contextId, handleContextUpdate]);

  const persistedTree = useMemo(() => extractPersistedContextTree(context as any), [context]);
  const steps = useMemo(
    () =>
      buildContextStepViews({
        filteredSteps: persistedTree.filteredSteps,
        persistedPartsByStep: persistedTree.persistedPartsByStep,
      }),
    [persistedTree.filteredSteps, persistedTree.persistedPartsByStep],
  );
  const stepsByEventId = useMemo(
    () =>
      buildEventStepsIndex({
        executions: persistedTree.persistedExecutions,
        steps,
      }),
    [persistedTree.persistedExecutions, steps],
  );

  const activeExecutionId = useMemo(() => {
    const currentExecutionId = asText((context as any)?.currentExecution?.id);
    if (currentExecutionId) return currentExecutionId;
    return steps.find((step) => step.status === "running")?.executionId ?? steps[0]?.executionId ?? null;
  }, [context, steps]);

  const persistedEvents = useMemo(() => {
    return persistedTree.persistedEvents
      .map((event) => {
        const attachedSteps = stepsByEventId.get(String(event.id)) ?? [];
        const renderedRuntimeSteps = attachedSteps.map((step) => {
          const readerInfo = streamReaderInfoByStepId[step.stepId];
          const liveEvent = liveEventsByStepId[step.stepId];
          const shouldUseLiveStep =
            Boolean(liveEvent) && step.status === "running";
          const renderedStep =
            shouldUseLiveStep
              ? withLiveStepParts({
                  step,
                  liveEvent,
                })
              : step;

          return {
            ...renderedStep,
            streamReader:
              readerInfo ?? defaultStreamReaderInfo(renderedStep),
          };
        });
        const renderedSteps = renderedRuntimeSteps.map(toPublicStep);
        const eventParts =
          attachedSteps.length > 0 && !isUserEvent(event)
            ? []
            : normalizeContextEventParts(
                Array.isArray(event.content?.parts) ? event.content.parts : [],
              );
        const hasRunningStep = renderedRuntimeSteps.some((step) => step.status === "running");

        return {
          ...event,
          executionId: renderedSteps[0]?.executionId ?? null,
          steps: renderedSteps,
          content: {
            ...(event.content ?? {}),
            parts: eventParts,
          },
          ...(hasRunningStep && !isUserEvent(event)
            ? {
                status: "pending",
              }
            : {}),
        } satisfies ContextEventForUI;
      });
  }, [
    liveEventsByStepId,
    persistedTree.persistedEvents,
    stepsByEventId,
    streamReaderInfoByStepId,
  ]);

  useEffect(() => {
    const persistedIds = new Set(persistedEvents.map((event) => String(event.id)));
    setOptimisticEvents((current) => {
      const next = current.filter((event) => !persistedIds.has(String(event.id)));
      return next.length === current.length ? current : next;
    });
  }, [persistedEvents]);

  useEffect(() => {
    syncContextStepStreamReaders({
      db,
      steps,
      streamChunkDelayMs: normalizedStreamChunkDelayMs,
      readers: stepReadersRef.current,
      setStreamReaderInfoByStepId,
      setLiveEventsByStepId,
      setTurnSubstateKey,
    });
  }, [db, normalizedStreamChunkDelayMs, steps]);

  useEffect(() => {
    return () => {
      abortAllStepReaders(stepReadersRef.current);
    };
  }, []);

  const effectiveContextStatus: ContextStatus =
    publicContext?.status ?? "open_idle";

  const stop = useCallback(() => {
    for (const controller of requestControllersRef.current) {
      controller.abort();
    }
    requestControllersRef.current.clear();
  }, []);

  const append = useCallback(
    async ({ parts, webSearch, reasoningLevel }: AppendArgs) => {
      const nextArgs = prepareAppendArgs
        ? await prepareAppendArgs({ parts, webSearch, reasoningLevel })
        : { parts, webSearch, reasoningLevel };
      const messages = partsToSendPayload(nextArgs.parts);
      if (messages[0].parts.length === 0) return;

      const activeContextId = selectedContextIdRef.current || randomUuidV4();
      if (!selectedContextIdRef.current) {
        selectedContextIdRef.current = activeContextId;
        handleContextUpdate(activeContextId);
      }

      const preparedRequestBody = prepareRequestBody
        ? await prepareRequestBody({
            messages,
            webSearch: nextArgs.webSearch,
            reasoningLevel: nextArgs.reasoningLevel,
            contextId: activeContextId,
          })
        : {
            messages,
            webSearch: Boolean(nextArgs.webSearch),
            reasoningLevel: nextArgs.reasoningLevel ?? "low",
            contextId: activeContextId,
          };
      const requestBody = {
        ...preparedRequestBody,
        contextId: asText(preparedRequestBody.contextId) || activeContextId,
      };

      const optimistic = messageToEphemeralEvent(messages[0], activeContextId);
      setOptimisticEvents((current) => [...current, optimistic]);
      setSendError(null);

      const abortController = new AbortController();
      requestControllersRef.current.add(abortController);
      setPendingRequests((current) => current + 1);

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Request failed with status ${response.status}.`);
        }

        const responseText = await response.text();
        const parsed = (() => {
          if (!responseText.trim()) return null;
          try {
            return JSON.parse(responseText) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const nextContextId = asText(parsed?.contextId);
        if (nextContextId) {
          handleContextUpdate(nextContextId);
        }
        const assistantEvent = asRecord(parsed?.assistantEvent) as ContextEventForUI | null;
        if (assistantEvent?.id) {
          setOptimisticEvents((current) => [
            ...current.filter((event) => String(event.id) !== String(assistantEvent.id)),
            {
              ...assistantEvent,
              __contextId: nextContextId || activeContextId,
            },
          ]);
        }
      } catch (error) {
        setOptimisticEvents((current) =>
          current.filter((event) => String(event.id) !== String(optimistic.id)),
        );
        setSendError(error instanceof Error ? error.message : "Request failed");
        throw error;
      } finally {
        requestControllersRef.current.delete(abortController);
        setPendingRequests((current) => Math.max(0, current - 1));
      }
    },
    [apiUrl, handleContextUpdate, prepareAppendArgs, prepareRequestBody],
  );

  const mergedEvents = useMemo(
    () =>
      mergeEvents({
        persisted: persistedEvents,
        optimistic: optimisticEvents,
        currentContextId: contextId,
      }),
    [contextId, optimisticEvents, persistedEvents],
  );

  const sendStatus: SendStatus =
    sendError
      ? "error"
      : pendingRequests > 0
        ? "submitting"
        : "idle";

  return {
    apiUrl,
    context: publicContext,
    contextId,
    contextStatus: effectiveContextStatus,
    activeExecutionId,
    turnSubstateKey,
    events: mergedEvents,
    sendStatus,
    sendError,
    stop,
    append,
  };
}
