"use client";

import type { InstantReactWebDatabase } from "@instantdb/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSchema } from "@/instant.schema";
import {
  asString,
  buildCodexReplayAssistantEvent,
  getCommandExecutionParts,
  resolveTurnMetadata,
} from "@/lib/examples/reactors/codex/shared";
import {
  buildCodexStepViews,
  consumePersistedCodexStepStream,
  extractCodexPersistedTree,
  nowIso,
  type CodexReplayedStepContent,
  type CodexReplayStatus,
  type CodexStepsController,
} from "./codex-steps-state";

type UseCodexStepsControllerParams = {
  db: InstantReactWebDatabase<AppSchema>;
  contextId: string | null;
  restart: () => Promise<void>;
  statusOverride?: CodexStepsController["status"] | null;
};

export function useCodexStepsController(
  params: UseCodexStepsControllerParams,
): CodexStepsController {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepReplayVersion, setStepReplayVersion] = useState(0);
  const [replayStatus, setReplayStatus] = useState<CodexReplayStatus>("idle");
  const [replayByteOffset, setReplayByteOffset] = useState(0);
  const [replayedStepContent, setReplayedStepContent] =
    useState<CodexReplayedStepContent | null>(null);

  const replayAbortControllerRef = useRef<AbortController | null>(null);

  const contextQuery = params.db.useQuery(
    params.contextId
      ? ({
          event_contexts: {
            $: { where: { id: params.contextId as any }, limit: 1 },
            executions: {
              $: {
                order: { createdAt: "desc" },
                limit: 50,
              },
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

  const steps = useMemo(
    () =>
      buildCodexStepViews({
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
      setReplayedStepContent(null);
      return;
    }

    if (!selectedStep.streamClientId && !selectedStep.streamId) {
      setReplayedStepContent({
        stepId: selectedStep.stepId,
        source: "stored",
        event: selectedStep.storedEvent,
        commandExecutions: getCommandExecutionParts(selectedStep.storedEvent),
        metadata: resolveTurnMetadata(selectedStep.storedEvent),
        trace: null,
        rawChunks: [],
        storedParts: selectedStep.storedParts,
      });
      setReplayStatus("completed");
      return;
    }

    const abortController = new AbortController();
    replayAbortControllerRef.current = abortController;
    const replayChunks: Array<Record<string, unknown>> = [];

    setReplayStatus("loading");
    setReplayedStepContent(null);

    const updateReplayContent = () => {
      if (replayChunks.length === 0) return;
      const replay = buildCodexReplayAssistantEvent({
        eventId: `codex-step-replay:${selectedStep.stepId}:${stepReplayVersion}`,
        createdAt: selectedStep.streamStartedAt || selectedStep.createdAt || nowIso(),
        chunks: replayChunks,
      });
      setReplayedStepContent({
        stepId: selectedStep.stepId,
        source: "stream",
        event: replay.event,
        commandExecutions: replay.commandExecutions,
        metadata: replay.metadata,
        trace: replay.trace,
        rawChunks: replayChunks.slice(),
        storedParts: selectedStep.storedParts,
      });

      if (selectedStep.status === "running") {
        setReplayStatus("live");
        return;
      }
      setReplayStatus("replaying");
    };

    void (async () => {
      try {
        await consumePersistedCodexStepStream({
          db: params.db,
          signal: abortController.signal,
          clientId: selectedStep.streamClientId,
          streamId: selectedStep.streamId,
          byteOffset: 0,
          onByteOffset: (byteOffset) => setReplayByteOffset(byteOffset),
          onChunk: async (chunk) => {
            replayChunks.push(chunk);
            updateReplayContent();
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
    selectedStep?.storedParts,
    selectedStep?.streamClientId,
    selectedStep?.streamId,
    selectedStep?.streamStartedAt,
    stepReplayVersion,
  ]);

  const status = useMemo<CodexStepsController["status"]>(() => {
    if (params.statusOverride) return params.statusOverride;
    if (!params.contextId) return "bootstrapping";
    if (selectedStep?.status === "running" || replayStatus === "loading" || replayStatus === "live") {
      return "streaming";
    }
    if (steps.length > 0) return "completed";
    return "bootstrapping";
  }, [params.contextId, params.statusOverride, replayStatus, selectedStep?.status, steps.length]);

  const executionId = selectedStep?.executionId ?? steps[0]?.executionId ?? null;

  return useMemo<CodexStepsController>(
    () => ({
      status,
      contextId: params.contextId,
      executionId,
      selectedStepId,
      steps,
      replayStatus,
      replayByteOffset,
      currentEvent: replayedStepContent?.event ?? selectedStep?.storedEvent ?? null,
      currentStoredParts:
        selectedStep?.storedParts.length
          ? selectedStep.storedParts
          : replayedStepContent?.storedParts ?? [],
      selectStep: (stepId: string) => {
        setSelectedStepId(stepId);
        setStepReplayVersion((current) => current + 1);
      },
      restart: params.restart,
    }),
    [
      executionId,
      params.contextId,
      params.restart,
      replayByteOffset,
      replayStatus,
      replayedStepContent,
      selectedStep,
      selectedStepId,
      status,
      steps,
    ],
  );
}
