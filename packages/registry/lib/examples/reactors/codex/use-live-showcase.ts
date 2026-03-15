"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppendArgs,
  ContextEventForUI,
  ContextValue,
} from "@/components/ekairos/context/context";
import { INPUT_TEXT_ITEM_TYPE } from "@/components/ekairos/context/context";
import { useOrgDb } from "@/lib/org-db-context";
import { codexReactorShowcase } from "@/lib/examples/reactors/codex/definition";
import {
  asRecord,
  asString,
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

function nowIso(): string {
  return new Date().toISOString();
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

function mapPersistedContextStatus(value: unknown): "open" | "streaming" | "closed" {
  const status = asString(value);
  if (status === "open_streaming" || status === "streaming") return "streaming";
  if (status === "closed") return "closed";
  return "open";
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
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

function sortEvents(events: ContextEventForUI[]) {
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
  } | null;
  metadata: {
    providerContextId: string | null;
    turnId: string | null;
    diff: string | null;
    tokenUsage: Record<string, unknown>;
    streamTrace: Record<string, unknown>;
  };
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
  const [serverMetadata, setServerMetadata] = useState<CodexShowcaseContextValue["metadata"]>({
    providerContextId: null,
    turnId: null,
    diff: null,
    tokenUsage: {},
    streamTrace: {},
  });
  const runCounterRef = useRef(0);
  const previousAppIdRef = useRef<string | null>(null);

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
          },
        } as any)
      : null,
  );
  const eventsQuery = db.useQuery(
    contextId
      ? ({
          event_items: {
            $: {
              where: { "context.id": contextId as any },
              order: { createdAt: "asc" },
            },
          },
        } as any)
      : null,
  );
  const executionsQuery = db.useQuery(
    contextId
      ? ({
          event_executions: {
            $: {
              where: { "context.id": contextId as any },
              order: { createdAt: "desc" },
              limit: 50,
            },
          },
        } as any)
      : null,
  );
  const stepsQuery = db.useQuery(
    contextId
      ? ({
          event_steps: {
            $: {
              order: { createdAt: "asc" },
              limit: 500,
            },
            execution: {},
          },
        } as any)
      : null,
  );
  const partsQuery = db.useQuery(
    contextId
      ? ({
          event_parts: {
            $: {
              order: { idx: "asc" },
              limit: 1000,
            },
            step: {},
          },
        } as any)
      : null,
  );

  const persistedContext = useMemo(() => {
    const rows = ((contextQuery as any)?.data?.event_contexts ?? []) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  }, [contextQuery]);

  const persistedEvents = useMemo(() => {
    const rows = ((eventsQuery as any)?.data?.event_items ?? []) as ContextEventForUI[];
    return sortEvents(Array.isArray(rows) ? rows : []);
  }, [eventsQuery]);
  const persistedExecutions = useMemo(() => {
    const rows =
      (((executionsQuery as any)?.data?.event_executions ?? []) as Array<Record<string, unknown>>) ?? [];
    return Array.isArray(rows) ? rows : [];
  }, [executionsQuery]);
  const persistedSteps = useMemo(() => {
    const rows =
      (((stepsQuery as any)?.data?.event_steps ?? []) as Array<Record<string, unknown>>) ?? [];
    return Array.isArray(rows) ? rows : [];
  }, [stepsQuery]);
  const persistedParts = useMemo(() => {
    const rows =
      (((partsQuery as any)?.data?.event_parts ?? []) as Array<Record<string, unknown>>) ?? [];
    return Array.isArray(rows) ? rows : [];
  }, [partsQuery]);

  const persistedEventIds = useMemo(
    () => new Set(persistedEvents.map((event) => String(event.id))),
    [persistedEvents],
  );

  useEffect(() => {
    if (!optimisticUserEvent) return;
    if (!persistedEventIds.has(String(optimisticUserEvent.id))) return;
    setOptimisticUserEvent(null);
  }, [optimisticUserEvent, persistedEventIds]);

  const mergedEvents = useMemo(() => {
    if (!optimisticUserEvent) return persistedEvents;
    if (persistedEventIds.has(String(optimisticUserEvent.id))) return persistedEvents;
    return sortEvents([...persistedEvents, optimisticUserEvent]);
  }, [optimisticUserEvent, persistedEventIds, persistedEvents]);

  useEffect(() => {
    if (!contextId) {
      setEntities(null);
      return;
    }

    const executionIds = new Set(
      persistedExecutions.map((row) => asString(row.id)).filter(Boolean),
    );
    const filteredSteps = persistedSteps.filter((row) =>
      executionIds.has(asString(asRecord(row.execution).id)),
    );
    const stepIds = new Set(filteredSteps.map((row) => asString(row.id)).filter(Boolean));
    const filteredParts = persistedParts.filter((row) =>
      stepIds.has(asString(asRecord(row.step).id)),
    );
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
          pickEntity(row, ["id", "status", "workflowRunId", "createdAt", "updatedAt"]),
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
          ...pickEntity(row, ["id", "status", "iteration", "kind", "createdAt", "updatedAt"]),
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
    persistedContext,
    persistedEvents,
    persistedExecutions,
    persistedParts,
    persistedSteps,
    session?.appId,
  ]);

  const stop = useCallback(() => {
    runCounterRef.current += 1;
    setSendStatus("idle");
    setTurnSubstateKey(null);
  }, []);

  const reset = useCallback(() => {
    stop();
    setSendError(null);
    setOptimisticUserEvent(null);
    setServerAssistantEvent(null);
    setServerCommandExecutions([]);
    setLlm(null);
    setTrace(null);
    setEntities(null);
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
    const triggerEventId = makeUuid();

    setSendError(null);
    setSendStatus("submitting");
    setTurnSubstateKey("code.runtime.calling");
    setOptimisticUserEvent({
      id: triggerEventId,
      type: "input",
      channel: "web",
      createdAt: nowIso(),
      status: "stored",
      content: { parts: [{ type: "text", text: promptText }] },
    });

    try {
      const runData = await fetchWithSession(async (tenant) => {
        const runResponse = await fetch(codexReactorShowcase.api.runPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appId: tenant.appId,
            adminToken: tenant.adminToken,
            prompt: promptText,
            contextId,
            triggerEventId,
          }),
        });
        const runResult = (await runResponse.json()) as LiveReactorShowcaseRunResponse;
        if (!runResponse.ok || !runResult.ok || !runResult.data) {
          throw new Error(runResult.error || "Codex showcase request failed.");
        }
        return runResult.data;
      });

      if (runCounterRef.current !== runToken) return;

      setContextId(asString(runData.contextId) || contextId);
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
      setSendStatus("idle");
      setTurnSubstateKey(null);
    } catch (error) {
      if (runCounterRef.current !== runToken) return;
      setSendStatus("error");
      setTurnSubstateKey(null);
      setOptimisticUserEvent(null);
      setServerAssistantEvent(null);
      setServerCommandExecutions([]);
      setAudit(null);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [contextId, fetchWithSession, sendStatus]);

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
    return sendStatus === "submitting" ? "streaming" : persisted;
  }, [persistedContext?.status, sendStatus]);

  return useMemo(
    () => ({
      apiUrl: codexReactorShowcase.api.runPath,
      contextId,
      contextStatus,
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
    }),
    [
      append,
      audit,
      commandExecutions,
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
      sendError,
      sendStatus,
      serverCommandExecutions,
      serverAssistantEvent,
      serverMetadata.diff,
      serverMetadata.providerContextId,
      serverMetadata.streamTrace,
      serverMetadata.tokenUsage,
      serverMetadata.turnId,
      session?.appId,
      status,
      stop,
      trace,
      turnSubstateKey,
    ],
  );
}
