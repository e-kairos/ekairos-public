"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppendArgs,
  ContextEventForUI,
  ContextValue,
} from "@/components/ekairos/context/context";
import {
  buildCodexStepViews,
  consumePersistedCodexStepStream,
  extractCodexPersistedTree,
  formatDate,
  nowIso,
  sortContextEvents,
  type CodexReplayedStepContent,
  type CodexReplayStatus,
  type CodexStepView,
} from "@/components/ekairos/agent/live/codex-steps-state";
import { INPUT_TEXT_ITEM_TYPE } from "@/components/ekairos/context/context";
import { useOrgDb } from "@/lib/org-db-context";
import { codexReactorShowcase } from "@/lib/examples/reactors/codex/definition";
import {
  asRecord,
  asString,
  buildCodexReplayAssistantEvent,
  getCommandExecutionParts,
  resolveTurnMetadata,
} from "@/lib/examples/reactors/codex/shared";
import type {
  LiveReactorShowcaseRunResponse,
  ReactorShowcaseEntitiesSnapshot,
} from "@/lib/examples/reactors/types";
import { useRegistrySession } from "@/lib/registry-session";

function makeUuid(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  return "00000000-0000-4000-8000-000000000000";
}

function extractPromptText(parts: any[]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const row = part as Record<string, unknown>;
      return typeof row.text === "string" ? row.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isUserEvent(event: ContextEventForUI | null | undefined) {
  const type = asString(event?.type);
  return type === INPUT_TEXT_ITEM_TYPE || type === "input" || type.startsWith("user.");
}

function mapPersistedContextStatus(value: unknown): "open_idle" | "open_streaming" | "closed" {
  const status = asString(value);
  if (status === "open_streaming" || status === "streaming") return "open_streaming";
  if (status === "closed") return "closed";
  return "open_idle";
}

function pickEntity(row: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) {
      const value = row[field];
      out[field] = value instanceof Date ? value.toISOString() : value;
    }
  }
  return out;
}

function buildStreamingAssistantEvent(params: {
  eventId: string;
  createdAt: string;
  chunks: Array<Record<string, unknown>>;
}) {
  return buildCodexReplayAssistantEvent(params);
}

function formatIncomingStreamText(chunks: Array<Record<string, unknown>>) {
  return chunks
    .map((chunk) => JSON.stringify(chunk))
    .join("\n");
}

const REPLAY_HISTORY_CHUNK_DELAY_MS = 8;

async function waitForReplayDelay(signal: AbortSignal, delayMs: number) {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);

    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      resolve();
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function buildReplayableEventStepIds(params: {
  mergedEvents: ContextEventForUI[];
  persistedExecutions: Array<Record<string, unknown>>;
  steps: CodexStepView[];
}) {
  const latestStepByExecutionId = new Map<string, string>();
  for (const step of params.steps) {
    if (!step.executionId || latestStepByExecutionId.has(step.executionId)) continue;
    latestStepByExecutionId.set(step.executionId, step.stepId);
  }

  const executionIdByReactionEventId = new Map<string, string>();
  for (const execution of params.persistedExecutions) {
    const reactionId = asString(asRecord(execution.reaction).id);
    const executionId = asString(execution.id);
    if (!reactionId || !executionId) continue;
    executionIdByReactionEventId.set(reactionId, executionId);
  }

  const next: Record<string, string> = {};
  for (const event of params.mergedEvents) {
    if (isUserEvent(event)) continue;
    const executionId =
      asString(asRecord((event as Record<string, unknown>).execution).id) ||
      executionIdByReactionEventId.get(String(event.id)) ||
      "";
    if (!executionId) continue;
    const stepId = latestStepByExecutionId.get(executionId);
    if (!stepId) continue;
    next[String(event.id)] = stepId;
  }

  return next;
}

type CodexShowcaseContextValue = ContextValue & {
  reset: () => void;
  definition: typeof codexReactorShowcase;
  title: string;
  tenantAppId: string | null;
  tenantStatus: string;
  llm: Record<string, unknown> | null;
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
  entities: ReactorShowcaseEntitiesSnapshot | null;
  commandExecutions: Array<Record<string, unknown>>;
  audit: {
    orderMatches: boolean;
    providerOrder: Array<Record<string, unknown>>;
    persistedOrder: Array<Record<string, unknown>>;
    rawProviderEvents?: Array<Record<string, unknown>>;
    rawReactorChunks?: Array<Record<string, unknown>>;
    rawPersistedParts?: Array<Record<string, unknown>>;
    comparison?: Record<string, unknown>;
  } | null;
  metadata: {
    providerContextId: string | null;
    turnId: string | null;
    diff: string | null;
    tokenUsage: Record<string, unknown>;
    streamTrace: Record<string, unknown>;
  };
  incomingStreamText: string;
  steps: CodexStepView[];
  replayableEventStepIds: Record<string, string>;
  selectedReplayEventId: string | null;
  replayEvent: (eventId: string) => void;
  selectStep: (stepId: string) => void;
  selectedStep: CodexStepView | null;
  replayStatus: CodexReplayStatus;
  replayError: string | null;
  replayByteOffset: number;
  replayedStepContent: CodexReplayedStepContent | null;
};

export function useLiveCodexShowcase(): CodexShowcaseContextValue {
  const { db } = useOrgDb();
  const { fetchWithSession, session, status } = useRegistrySession();
  if (!db?.useQuery) {
    throw new Error("useLiveCodexShowcase requires an initialized Instant db.");
  }
  const [contextId, setContextId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);
  const [optimisticUserEvent, setOptimisticUserEvent] = useState<ContextEventForUI | null>(null);
  const [serverAssistantEvent, setServerAssistantEvent] = useState<ContextEventForUI | null>(null);
  const [serverCommandExecutions, setServerCommandExecutions] = useState<Array<Record<string, unknown>>>([]);
  const [audit, setAudit] = useState<CodexShowcaseContextValue["audit"]>(null);
  const [llm, setLlm] = useState<Record<string, unknown> | null>(null);
  const [trace, setTrace] = useState<CodexShowcaseContextValue["trace"]>(null);
  const [entities, setEntities] = useState<ReactorShowcaseEntitiesSnapshot | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedReplayEventId, setSelectedReplayEventId] = useState<string | null>(null);
  const [stepReplayVersion, setStepReplayVersion] = useState(0);
  const [replayStatus, setReplayStatus] = useState<CodexReplayStatus>("idle");
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayByteOffset, setReplayByteOffset] = useState(0);
  const [replayedStepContent, setReplayedStepContent] =
    useState<CodexReplayedStepContent | null>(null);
  const [serverMetadata, setServerMetadata] = useState<CodexShowcaseContextValue["metadata"]>({
    providerContextId: null,
    turnId: null,
    diff: null,
    tokenUsage: {},
    streamTrace: {},
  });
  const runCounterRef = useRef(0);
  const previousAppIdRef = useRef<string | null>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const streamChunksRef = useRef<Array<Record<string, unknown>>>([]);
  const currentTriggerEventIdRef = useRef<string | null>(null);
  const currentRunTokenRef = useRef<number>(0);
  const currentStreamClientIdRef = useRef<string | null>(null);
  const currentStreamByteOffsetRef = useRef<number>(0);
  const selectedStepSnapshotRef = useRef<{
    status: string;
    streamSize: number | null;
  } | null>(null);
  const replayAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setContextId((current) => current ?? makeUuid());
  }, []);

  useEffect(() => {
    const nextAppId = session?.appId ?? null;
    const previousAppId = previousAppIdRef.current;
    if (previousAppId === null) {
      previousAppIdRef.current = nextAppId;
      return;
    }
    if (previousAppId === nextAppId) return;

    previousAppIdRef.current = nextAppId;
    runAbortControllerRef.current?.abort();
    streamAbortControllerRef.current?.abort();
    replayAbortControllerRef.current?.abort();
    runAbortControllerRef.current = null;
    streamAbortControllerRef.current = null;
    replayAbortControllerRef.current = null;
    streamChunksRef.current = [];
    currentTriggerEventIdRef.current = null;
    currentRunTokenRef.current = 0;
    currentStreamClientIdRef.current = null;
    currentStreamByteOffsetRef.current = 0;
    setSendStatus("idle");
    setSendError(null);
    setTurnSubstateKey(null);
    setOptimisticUserEvent(null);
    setServerAssistantEvent(null);
    setServerCommandExecutions([]);
    setAudit(null);
    setLlm(null);
    setTrace(null);
    setEntities(null);
    setSelectedStepId(null);
    setSelectedReplayEventId(null);
    setReplayStatus("idle");
    setReplayError(null);
    setReplayByteOffset(0);
    setReplayedStepContent(null);
    setServerMetadata({
      providerContextId: null,
      turnId: null,
      diff: null,
      tokenUsage: {},
      streamTrace: {},
    });
    setContextId(makeUuid());
  }, [session?.appId]);

  const contextQuery = db.useQuery(
    contextId
      ? ({
          event_contexts: {
            $: { where: { id: contextId as any }, limit: 1 },
            items: {
              $: {
                order: { createdAt: "asc" },
              },
              execution: {},
            },
            currentExecution: {},
            executions: {
              $: {
                order: { createdAt: "desc" },
                limit: 50,
              },
              trigger: {},
              reaction: {},
              steps: {
                $: {
                  order: { createdAt: "asc" },
                  limit: 500,
                },
                stream: {},
                parts: {
                  $: {
                    order: { idx: "asc" },
                    limit: 1000,
                  },
                },
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
  const persistedTree = useMemo(
    () => extractCodexPersistedTree(persistedContext),
    [persistedContext],
  );
  const persistedEvents = persistedTree.persistedEvents;
  const persistedExecutions = persistedTree.persistedExecutions;
  const persistedSteps = persistedTree.persistedSteps;
  const persistedParts = persistedTree.persistedParts;
  const filteredSteps = persistedTree.filteredSteps;
  const filteredParts = persistedTree.filteredParts;
  const persistedPartsByStep = persistedTree.persistedPartsByStep;

  const persistedEventIds = useMemo(
    () => new Set(persistedEvents.map((event) => String(event.id))),
    [persistedEvents],
  );
  const steps = useMemo<CodexStepView[]>(() => {
    return buildCodexStepViews({
      filteredSteps,
      persistedPartsByStep,
    });
  }, [filteredSteps, persistedPartsByStep]);

  useEffect(() => {
    if (!optimisticUserEvent) return;
    if (!persistedEventIds.has(String(optimisticUserEvent.id))) return;
    setOptimisticUserEvent(null);
  }, [optimisticUserEvent, persistedEventIds]);

  const mergedEvents = useMemo(() => {
    const next = [...persistedEvents];
    if (optimisticUserEvent && !persistedEventIds.has(String(optimisticUserEvent.id))) {
      next.push(optimisticUserEvent);
    }
    if (serverAssistantEvent) {
      const assistantId = String(serverAssistantEvent.id);
      const existingIndex = next.findIndex((row) => String(row.id) === assistantId);
      if (existingIndex === -1) {
        next.push(serverAssistantEvent);
      } else if (sendStatus === "submitting") {
        next[existingIndex] = serverAssistantEvent;
      }
    }
    return sortContextEvents(next);
  }, [
    optimisticUserEvent,
    persistedEventIds,
    persistedEvents,
    sendStatus,
    serverAssistantEvent,
  ]);

  useEffect(() => {
    if (!contextId) {
      setEntities(null);
      return;
    }
    const latestExecution = persistedExecutions[0];

    setEntities({
      appId: session?.appId ?? "",
      contextId,
      context: persistedContext
        ? pickEntity(persistedContext, [
            "id",
            "key",
            "status",
            "createdAt",
            "updatedAt",
            "content",
          ])
        : null,
      latestExecutionAt: latestExecution ? formatDate(latestExecution.createdAt) : null,
      counts: {
        executions: persistedExecutions.length,
        items: persistedEvents.length,
        steps: filteredSteps.length,
        parts: filteredParts.length,
      },
      entities: {
        executions: persistedExecutions.map((row) =>
          pickEntity(row, [
            "id",
            "status",
            "workflowRunId",
            "activeStreamId",
            "activeStreamClientId",
            "lastStreamId",
            "lastStreamClientId",
            "createdAt",
            "updatedAt",
          ]),
        ),
        items: persistedEvents.map((row) =>
          pickEntity(row as unknown as Record<string, unknown>, [
            "id",
            "type",
            "status",
            "channel",
            "createdAt",
            "content",
          ]),
        ),
        steps: filteredSteps.map((row) => ({
          ...pickEntity(row, [
            "id",
            "status",
            "iteration",
            "kind",
            "streamId",
            "streamClientId",
            "streamStartedAt",
            "streamFinishedAt",
            "streamAbortReason",
            "createdAt",
            "updatedAt",
          ]),
          executionId: asString(asRecord(row.execution).id) || null,
        })),
        parts: filteredParts.map((row) => ({
          ...pickEntity(row, ["id", "key", "idx", "type", "part", "updatedAt"]),
          stepId: asString(asRecord(row.step).id) || null,
        })),
      },
    });
  }, [
    contextId,
    filteredParts,
    filteredSteps,
    persistedContext,
    persistedEvents,
    persistedExecutions,
    session?.appId,
  ]);

  const selectedStep = useMemo(
    () => steps.find((step) => step.stepId === selectedStepId) ?? null,
    [selectedStepId, steps],
  );
  const replayableEventStepIds = useMemo(
    () =>
      buildReplayableEventStepIds({
        mergedEvents,
        persistedExecutions,
        steps,
      }),
    [mergedEvents, persistedExecutions, steps],
  );

  useEffect(() => {
    if (!selectedReplayEventId && !selectedStepId) {
      setReplayStatus("idle");
      setReplayError(null);
      setReplayByteOffset(0);
      setReplayedStepContent(null);
      return;
    }

    if (steps.length === 0) {
      setSelectedStepId(null);
      setSelectedReplayEventId(null);
      setReplayStatus("idle");
      setReplayError(null);
      setReplayByteOffset(0);
      setReplayedStepContent(null);
      return;
    }
    if (selectedStepId && steps.some((step) => step.stepId === selectedStepId)) {
      return;
    }
    setSelectedStepId(null);
  }, [selectedReplayEventId, selectedStepId, steps]);

  useEffect(() => {
    if (!selectedReplayEventId) return;
    const mappedStepId = replayableEventStepIds[selectedReplayEventId];
    if (!mappedStepId) {
      setSelectedReplayEventId(null);
      setSelectedStepId(null);
      return;
    }
    setSelectedStepId((current) => (current === mappedStepId ? current : mappedStepId));
  }, [replayableEventStepIds, selectedReplayEventId]);

  useEffect(() => {
    selectedStepSnapshotRef.current = selectedStep
      ? {
          status: selectedStep.status,
          streamSize: selectedStep.streamSize,
        }
      : null;
  }, [selectedStep]);

  const buildStoredReplayContent = useCallback(
    (step: CodexStepView): CodexReplayedStepContent => ({
      stepId: step.stepId,
      source: "stored",
      event: step.storedEvent,
      commandExecutions: getCommandExecutionParts(step.storedEvent),
      metadata: resolveTurnMetadata(step.storedEvent),
      trace: null,
      rawChunks: [],
      storedParts: step.storedParts,
    }),
    [],
  );

  const replayEvent = useCallback((eventId: string) => {
    const stepId = replayableEventStepIds[eventId];
    if (!stepId) return;
    setSelectedReplayEventId(eventId);
    setSelectedStepId(stepId);
    setStepReplayVersion((current) => current + 1);
  }, [replayableEventStepIds]);

  const selectStep = useCallback((stepId: string) => {
    setSelectedReplayEventId(null);
    setSelectedStepId(stepId);
    setStepReplayVersion((current) => current + 1);
  }, []);

  const stop = useCallback(() => {
    runCounterRef.current += 1;
    runAbortControllerRef.current?.abort();
    streamAbortControllerRef.current?.abort();
    runAbortControllerRef.current = null;
    streamAbortControllerRef.current = null;
    currentTriggerEventIdRef.current = null;
    currentRunTokenRef.current = 0;
    currentStreamClientIdRef.current = null;
    currentStreamByteOffsetRef.current = 0;
    setSendStatus("idle");
    setTurnSubstateKey(null);
  }, []);

  const reset = useCallback(() => {
    stop();
    replayAbortControllerRef.current?.abort();
    replayAbortControllerRef.current = null;
    streamChunksRef.current = [];
    setSendError(null);
    setOptimisticUserEvent(null);
    setServerAssistantEvent(null);
    setServerCommandExecutions([]);
    setLlm(null);
    setTrace(null);
    setEntities(null);
    setSelectedStepId(null);
    setSelectedReplayEventId(null);
    setReplayStatus("idle");
    setReplayError(null);
    setReplayByteOffset(0);
    setReplayedStepContent(null);
    setServerMetadata({
      providerContextId: null,
      turnId: null,
      diff: null,
      tokenUsage: {},
      streamTrace: {},
    });
    setContextId(makeUuid());
  }, [stop]);

  const append = useCallback(async (args: AppendArgs) => {
    if (sendStatus === "submitting") return;
    const promptText = extractPromptText(args.parts);
    if (!promptText) return;

    const runToken = runCounterRef.current + 1;
    runCounterRef.current = runToken;
    currentRunTokenRef.current = runToken;
    const triggerEventId = makeUuid();
    currentTriggerEventIdRef.current = triggerEventId;
    const effectiveContextId = contextId || makeUuid();

    runAbortControllerRef.current?.abort();
    streamAbortControllerRef.current?.abort();
    const runAbort = new AbortController();
    runAbortControllerRef.current = runAbort;
    streamChunksRef.current = [];
    currentStreamClientIdRef.current = null;
    currentStreamByteOffsetRef.current = 0;

    setSendError(null);
    setSendStatus("submitting");
    setTurnSubstateKey("code.runtime.calling");
    if (!contextId) {
      setContextId(effectiveContextId);
    }
    setServerAssistantEvent(null);
    setServerCommandExecutions([]);
    setAudit(null);
    setLlm(null);
    setTrace(null);
    setServerMetadata({
      providerContextId: null,
      turnId: null,
      diff: null,
      tokenUsage: {},
      streamTrace: {},
    });
    setOptimisticUserEvent({
      id: triggerEventId,
      type: "input",
      channel: "web",
      createdAt: nowIso(),
      status: "stored",
      content: { parts: [{ type: "text", text: promptText }] },
    });

    try {
      const tenant = await fetchWithSession(async (currentSession) => currentSession);
      const runPromise = (async () => {
        const runResponse = await fetch(codexReactorShowcase.api.runPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appId: tenant.appId,
            adminToken: tenant.adminToken,
            prompt: promptText,
            contextId: effectiveContextId,
            triggerEventId,
          }),
          signal: runAbort.signal,
        });
        const runResult = (await runResponse.json()) as LiveReactorShowcaseRunResponse;
        if (!runResponse.ok || !runResult.ok || !runResult.data) {
          throw new Error(runResult.error || "Codex showcase request failed.");
        }
        return runResult.data;
      })();

      const runData = await runPromise;

      if (runCounterRef.current !== runToken) return;
      runAbortControllerRef.current = null;

      setContextId(asString(runData.contextId) || effectiveContextId);
      setServerAssistantEvent(
        runData.assistantEvent &&
          typeof runData.assistantEvent === "object"
          ? (runData.assistantEvent as ContextEventForUI)
          : null,
      );
      setServerCommandExecutions(
        Array.isArray(runData.commandExecutions)
          ? (runData.commandExecutions as Array<Record<string, unknown>>)
          : [],
      );
      setAudit(
        runData.audit && typeof runData.audit === "object"
          ? {
              orderMatches: Boolean(runData.audit.orderMatches),
              providerOrder: Array.isArray(runData.audit.providerOrder)
                ? (runData.audit.providerOrder as Array<Record<string, unknown>>)
                : [],
              persistedOrder: Array.isArray(runData.audit.persistedOrder)
                ? (runData.audit.persistedOrder as Array<Record<string, unknown>>)
                : [],
              rawProviderEvents: Array.isArray((runData.audit as any).rawProviderEvents)
                ? ((runData.audit as any).rawProviderEvents as Array<Record<string, unknown>>)
                : [],
              rawReactorChunks: Array.isArray((runData.audit as any).rawReactorChunks)
                ? ((runData.audit as any).rawReactorChunks as Array<Record<string, unknown>>)
                : [],
              rawPersistedParts: Array.isArray((runData.audit as any).rawPersistedParts)
                ? ((runData.audit as any).rawPersistedParts as Array<Record<string, unknown>>)
                : [],
              comparison:
                (runData.audit as any).comparison &&
                typeof (runData.audit as any).comparison === "object"
                  ? ((runData.audit as any).comparison as Record<string, unknown>)
                  : {},
            }
          : null,
      );
      setLlm(
        runData.llm && typeof runData.llm === "object"
          ? (runData.llm as Record<string, unknown>)
          : null,
      );
      setTrace(runData.trace);
      setServerMetadata({
        providerContextId: asString(runData.metadata?.providerContextId) || null,
        turnId: asString(runData.metadata?.turnId) || null,
        diff: asString(runData.metadata?.diff) || null,
        tokenUsage:
          runData.metadata?.tokenUsage && typeof runData.metadata.tokenUsage === "object"
            ? (runData.metadata.tokenUsage as Record<string, unknown>)
            : {},
        streamTrace:
          runData.metadata?.streamTrace && typeof runData.metadata.streamTrace === "object"
            ? (runData.metadata.streamTrace as Record<string, unknown>)
            : {},
      });
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      setSendStatus("idle");
      setTurnSubstateKey(null);
      currentTriggerEventIdRef.current = null;
      currentRunTokenRef.current = 0;
      currentStreamClientIdRef.current = null;
      currentStreamByteOffsetRef.current = 0;
    } catch (error) {
      if (runCounterRef.current !== runToken) return;
      runAbortControllerRef.current = null;
      setSendStatus("error");
      setTurnSubstateKey(null);
      setOptimisticUserEvent(null);
      setServerAssistantEvent(null);
      setServerCommandExecutions([]);
      setAudit(null);
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      currentTriggerEventIdRef.current = null;
      currentRunTokenRef.current = 0;
      currentStreamClientIdRef.current = null;
      currentStreamByteOffsetRef.current = 0;
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [contextId, fetchWithSession, sendStatus]);

  useEffect(() => {
    if (sendStatus !== "submitting") return;
    if (!contextId) return;
    const triggerEventId = currentTriggerEventIdRef.current;
    if (!triggerEventId) return;

    const execution = persistedExecutions.find(
      (row) => asString(asRecord(row.trigger).id) === triggerEventId,
    );
    if (!execution) return;

    const executionId = asString(execution.id);
    const candidateSteps = persistedSteps
      .filter((row) => asString(asRecord(row.execution).id) === executionId)
      .sort((a, b) => {
        const aIteration = Number(a.iteration ?? -1);
        const bIteration = Number(b.iteration ?? -1);
        if (aIteration !== bIteration) return bIteration - aIteration;
        return String(b.id).localeCompare(String(a.id));
      });

    const activeStep =
      candidateSteps.find((row) => asString(row.status) === "running") ??
      candidateSteps[0];
    if (!activeStep) return;

    const streamClientId = asString(activeStep.streamClientId);
    const streamId = asString(activeStep.streamId);
    if (!streamClientId && !streamId) return;

    const streamKey = streamClientId || streamId;
    if (currentStreamClientIdRef.current === streamKey) return;

    streamAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;
    currentStreamClientIdRef.current = streamKey;
    currentStreamByteOffsetRef.current = 0;

    const streamingAssistantId = `codex-stream:${currentRunTokenRef.current}`;
    const streamingCreatedAt = nowIso();

    void (async () => {
      try {
        await consumePersistedCodexStepStream({
          db,
          signal: abortController.signal,
          clientId: streamClientId,
          streamId,
          byteOffset: currentStreamByteOffsetRef.current,
          onByteOffset: (byteOffset) => {
            currentStreamByteOffsetRef.current = byteOffset;
          },
          onChunk: (chunk) => {
            streamChunksRef.current = [...streamChunksRef.current, chunk];
            if (currentRunTokenRef.current === 0) return;
            const live = buildStreamingAssistantEvent({
              eventId: streamingAssistantId,
              createdAt: streamingCreatedAt,
              chunks: streamChunksRef.current,
            });
            setServerAssistantEvent(live.event);
            setServerCommandExecutions(live.commandExecutions);
            setTrace(live.trace);
            setServerMetadata({
              providerContextId: live.metadata.providerContextId,
              turnId: live.metadata.turnId,
              diff: live.metadata.diff,
              tokenUsage: live.metadata.tokenUsage,
              streamTrace: live.streamTrace,
            });
          },
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setSendError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [db, persistedExecutions, persistedSteps, sendStatus, contextId]);

  useEffect(() => {
    replayAbortControllerRef.current?.abort();
    replayAbortControllerRef.current = null;
    setReplayError(null);
    setReplayByteOffset(0);

    if (!selectedStep) {
      setReplayStatus("idle");
      setReplayedStepContent(null);
      return;
    }

    if (!selectedStep.streamClientId && !selectedStep.streamId) {
      setReplayedStepContent(buildStoredReplayContent(selectedStep));
      setReplayStatus("completed");
      return;
    }

    const abortController = new AbortController();
    replayAbortControllerRef.current = abortController;
    const replayEventId = `codex-step-replay:${selectedStep.stepId}:${stepReplayVersion}`;
    const replayCreatedAt =
      selectedStep.streamStartedAt || selectedStep.createdAt || nowIso();
    const replayChunks: Array<Record<string, unknown>> = [];
    let replayedByteOffset = 0;

    setReplayStatus("loading");
    setReplayedStepContent(null);

    const shouldDelayReplayChunk = (parsedOffset: number) => {
      const currentSnapshot = selectedStepSnapshotRef.current;
      if (!currentSnapshot) return false;
      if (currentSnapshot.status !== "running") return true;
      return (
        typeof currentSnapshot.streamSize === "number" &&
        currentSnapshot.streamSize > 0 &&
        parsedOffset < currentSnapshot.streamSize
      );
    };

    const updateReplayContent = () => {
      if (replayChunks.length === 0) return;
      const replay = buildCodexReplayAssistantEvent({
        eventId: replayEventId,
        createdAt: replayCreatedAt,
        chunks: replayChunks,
      });
      setReplayedStepContent({
        stepId: selectedStep.stepId,
        source: "stream",
        event: replay.event as ContextEventForUI,
        commandExecutions: replay.commandExecutions,
        metadata: replay.metadata,
        trace: replay.trace,
        rawChunks: replayChunks.slice(),
        storedParts: selectedStep.storedParts,
      });

      const currentSnapshot = selectedStepSnapshotRef.current;
      if (replay.isCompleted) {
        setReplayStatus("completed");
        return;
      }
      if (currentSnapshot?.status === "running") {
        if (
          typeof currentSnapshot.streamSize === "number" &&
          currentSnapshot.streamSize > 0 &&
          replayedByteOffset >= currentSnapshot.streamSize
        ) {
          setReplayStatus("live");
          return;
        }
        setReplayStatus("replaying");
        return;
      }
      setReplayStatus("replaying");
    };

    void (async () => {
      try {
        await consumePersistedCodexStepStream({
          db,
          signal: abortController.signal,
          clientId: selectedStep.streamClientId,
          streamId: selectedStep.streamId,
          byteOffset: 0,
          onChunk: async (chunk, info) => {
            replayedByteOffset = info.parsedByteOffset;
            setReplayByteOffset(info.parsedByteOffset);
            replayChunks.push(chunk);
            updateReplayContent();
            if (shouldDelayReplayChunk(info.parsedByteOffset)) {
              await waitForReplayDelay(
                abortController.signal,
                REPLAY_HISTORY_CHUNK_DELAY_MS,
              );
            }
          },
          onDone: () => {
            if (!abortController.signal.aborted) {
              setReplayStatus("completed");
            }
          },
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setReplayStatus("error");
          setReplayError(error instanceof Error ? error.message : String(error));
        }
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
    buildStoredReplayContent,
    db,
    selectedStep?.createdAt,
    selectedStep?.stepId,
    selectedStep?.streamClientId,
    selectedStep?.streamId,
    selectedStep?.streamStartedAt,
    stepReplayVersion,
  ]);

  const latestAssistantEvent = useMemo(() => {
    for (let index = mergedEvents.length - 1; index >= 0; index -= 1) {
      const event = mergedEvents[index];
      if (!isUserEvent(event)) return event;
    }
    return serverAssistantEvent;
  }, [mergedEvents, serverAssistantEvent]);

  const metadata = useMemo(
    () => resolveTurnMetadata(latestAssistantEvent, llm),
    [latestAssistantEvent, llm],
  );
  const commandExecutions = useMemo(
    () => {
      const fromEvent = getCommandExecutionParts(latestAssistantEvent);
      return fromEvent.length > 0 ? fromEvent : serverCommandExecutions;
    },
    [latestAssistantEvent, serverCommandExecutions],
  );

  const contextStatus = useMemo(() => {
    const persisted = mapPersistedContextStatus(persistedContext?.status);
    return sendStatus === "submitting" ? "open_streaming" : persisted;
  }, [persistedContext?.status, sendStatus]);

  const activeExecutionId = useMemo(() => {
    const currentExecutionId = asString(asRecord(persistedContext?.currentExecution).id);
    if (currentExecutionId) return currentExecutionId;
    const runningExecution = persistedExecutions.find(
      (row) => asString(row.status) === "executing",
    );
    return runningExecution ? asString(runningExecution.id) || null : null;
  }, [persistedContext, persistedExecutions]);

  const context = useMemo(() => {
    if (!contextId && !persistedContext) return null;
    const persistedCurrentExecution = asRecord(persistedContext?.currentExecution);
    const currentExecutionId = asString(persistedCurrentExecution.id);

    return {
      id: asString(persistedContext?.id) || contextId || "",
      key: asString(persistedContext?.key) || null,
      name: asString(persistedContext?.name) || null,
      status: contextStatus,
      content: persistedContext?.content,
      currentExecution: currentExecutionId
        ? {
            id: currentExecutionId,
            status: asString(persistedCurrentExecution.status) || null,
          }
        : null,
    };
  }, [contextId, contextStatus, persistedContext]);

  const incomingStreamText = useMemo(
    () => formatIncomingStreamText(trace?.chunks ?? []),
    [trace],
  );

  return useMemo(
    () => ({
      apiUrl: codexReactorShowcase.api.runPath,
      context,
      contextId,
      contextStatus,
      activeExecutionId,
      turnSubstateKey,
      events: mergedEvents,
      sendStatus,
      sendError,
      stop,
      append,
      reset,
      definition: codexReactorShowcase,
      title: codexReactorShowcase.title,
      tenantAppId: session?.appId ?? null,
      tenantStatus: status,
      llm,
      trace,
      entities,
      commandExecutions,
      audit,
      metadata: {
        providerContextId: serverMetadata.providerContextId || metadata.providerContextId,
        turnId: serverMetadata.turnId || metadata.turnId,
        diff: serverMetadata.diff || metadata.diff,
        tokenUsage:
          Object.keys(serverMetadata.tokenUsage).length > 0
            ? serverMetadata.tokenUsage
            : metadata.tokenUsage,
        streamTrace:
          Object.keys(serverMetadata.streamTrace).length > 0
            ? serverMetadata.streamTrace
            : metadata.streamTrace,
      },
      incomingStreamText,
      steps,
      replayableEventStepIds,
      selectedReplayEventId,
      replayEvent,
      selectStep,
      selectedStep,
      replayStatus,
      replayError,
      replayByteOffset,
      replayedStepContent,
    }),
    [
      append,
      audit,
      activeExecutionId,
      commandExecutions,
      context,
      contextId,
      contextStatus,
      entities,
      llm,
      mergedEvents,
      metadata.diff,
      metadata.providerContextId,
      metadata.streamTrace,
      metadata.tokenUsage,
      metadata.turnId,
      reset,
      replayByteOffset,
      replayError,
      replayEvent,
      replayableEventStepIds,
      replayStatus,
      replayedStepContent,
      selectStep,
      sendError,
      sendStatus,
      serverMetadata.diff,
      serverMetadata.providerContextId,
      serverMetadata.streamTrace,
      serverMetadata.tokenUsage,
      serverMetadata.turnId,
      selectedReplayEventId,
      selectedStep,
      session?.appId,
      status,
      stop,
      steps,
      trace,
      turnSubstateKey,
      incomingStreamText,
    ],
  );
}
