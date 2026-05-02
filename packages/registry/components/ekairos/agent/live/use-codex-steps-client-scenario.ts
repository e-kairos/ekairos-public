"use client";

import type { InstantReactWebDatabase } from "@instantdb/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSISTANT_MESSAGE_TYPE,
  INPUT_TEXT_ITEM_TYPE,
  type ContextEventForUI,
} from "@/components/ekairos/context/context";
import fixture from "@/components/ekairos/agent/mocks/codex-run.fixture.json";
import type { AppSchema } from "@/instant.schema";
import {
  asRecord,
  asString,
  buildCodexReplayAssistantEvent,
  getCommandExecutionParts,
  resolveTurnMetadata,
} from "@/lib/examples/reactors/codex/shared";
import { nowIso, type CodexStepsController } from "./codex-steps-state";
import { useCodexStepsController } from "./use-codex-steps-controller";

type ScenarioFixture = {
  request: {
    prompt: string;
  };
  notifications: Array<{
    delayMs: number;
    notification: Record<string, unknown>;
  }>;
};

type ScenarioIds = {
  contextId: string;
  triggerEventId: string;
  reactionEventId: string;
  executionId: string;
  stepId: string;
  streamId: string;
  streamClientId: string;
};

type CodexChunkMappingResult = {
  skip?: boolean;
  chunkType: string;
  providerChunkType?: string;
  actionRef?: string | null;
  data?: Record<string, unknown>;
};

const CONTEXT_STEP_STREAM_VERSION = 1;

function makeUuid(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  return "00000000-0000-4000-8000-000000000000";
}

function wait(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);

    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      reject(new Error("scenario_aborted"));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function buildTriggerEvent(id: string, prompt: string): ContextEventForUI {
  return {
    id,
    type: INPUT_TEXT_ITEM_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: {
      parts: [{ type: "text", text: prompt }],
    },
  };
}

function buildPendingReactionEvent(id: string): ContextEventForUI {
  return {
    id,
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "pending",
    content: {
      parts: [],
    },
  };
}

function createPersistedStepStreamChunk(params: {
  at?: string;
  sequence: number;
  chunkType: string;
  providerChunkType?: string;
  actionRef?: string;
  data?: Record<string, unknown>;
}) {
  return {
    version: CONTEXT_STEP_STREAM_VERSION,
    at: params.at ?? nowIso(),
    sequence: params.sequence,
    chunkType: params.chunkType,
    providerChunkType: params.providerChunkType,
    actionRef: params.actionRef,
    data: params.data,
  };
}

function encodePersistedStepStreamChunk(chunk: Record<string, unknown>) {
  return `${JSON.stringify(chunk)}\n`;
}

function mapCodexAppServerNotification(
  notification: Record<string, unknown>,
): CodexChunkMappingResult | null {
  const method = typeof notification.method === "string" ? notification.method : "";
  const params = asRecord(notification.params);

  if (!method) return null;

  switch (method) {
    case "turn/started":
      return {
        chunkType: "chunk.start",
        providerChunkType: method,
        data: { params },
      };
    case "turn/completed":
      return {
        chunkType: "chunk.finish",
        providerChunkType: method,
        data: { params },
      };
    case "item/started":
      return {
        chunkType: "chunk.text_start",
        providerChunkType: method,
        data: { params },
      };
    case "item/agentMessage/delta":
      return {
        chunkType: "chunk.text_delta",
        providerChunkType: method,
        data: { params },
      };
    case "item/completed":
      return {
        chunkType: "chunk.text_end",
        providerChunkType: method,
        data: { params },
      };
    case "context/tokenUsage/updated":
      return {
        chunkType: "chunk.response_metadata",
        providerChunkType: method,
        data: { params },
      };
    case "context/started":
      return {
        chunkType: "chunk.message_metadata",
        providerChunkType: method,
        data: { params },
      };
    default:
      return {
        skip: true,
        chunkType: "chunk.message_metadata",
        providerChunkType: method,
        data: { params },
      };
  }
}

async function createClientPersistedStepStream(params: {
  db: InstantReactWebDatabase<AppSchema>;
  executionId: string;
  stepId: string;
}) {
  const startedAt = new Date();
  const streamClientId = `event-step:${params.stepId}`;
  const writeStream = params.db.streams.createWriteStream({
    clientId: streamClientId,
  });
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

  return { writer, streamId, streamClientId };
}

async function persistScenarioResult(params: {
  db: InstantReactWebDatabase<AppSchema>;
  ids: ScenarioIds;
  status: "completed" | "failed";
  abortReason: string | null;
  chunks: Array<Record<string, unknown>>;
}) {
  const replay = buildCodexReplayAssistantEvent({
    eventId: params.ids.reactionEventId,
    createdAt: nowIso(),
    chunks: params.chunks,
  });
  const turnMetadata = resolveTurnMetadata(replay.event);
  const commandExecutions = getCommandExecutionParts(replay.event);
  const persistedParts = [...replay.event.content.parts, ...commandExecutions];

  const txs: any[] = [
    params.db.tx.event_items[params.ids.reactionEventId].update({
      type: ASSISTANT_MESSAGE_TYPE,
      channel: "web",
      createdAt: nowIso(),
      status: params.status === "completed" ? "completed" : "error",
      content: {
        parts: persistedParts,
      },
    }),
    params.db.tx.event_steps[params.ids.stepId].update({
      status: params.status === "completed" ? "completed" : "failed",
      updatedAt: new Date(),
      streamFinishedAt: new Date(),
      streamAbortReason: params.abortReason,
    }),
    params.db.tx.event_executions[params.ids.executionId].update({
      status: params.status,
      activeStreamId: null,
      activeStreamClientId: null,
      lastStreamId: params.ids.streamId,
      lastStreamClientId: params.ids.streamClientId,
      updatedAt: new Date(),
    }),
    params.db.tx.event_contexts[params.ids.contextId].update({
      status: "closed",
      updatedAt: new Date(),
      content: {
        source: "registry.codex-steps.client",
        providerContextId: turnMetadata.providerContextId,
        turnId: turnMetadata.turnId,
      },
    }),
  ];

  persistedParts.forEach((part, idx) => {
    const key = `${params.ids.stepId}:${idx}`;
    const partId = makeUuid();
    txs.push(
      params.db.tx.event_parts[partId]
        .create({
          stepId: params.ids.stepId,
          idx,
          key,
          type: asString((part as Record<string, unknown>)?.type) || undefined,
          part,
          updatedAt: new Date(),
        })
        .link({ step: params.ids.stepId }),
    );
  });

  await params.db.transact(txs as any);
}

export function useCodexStepsClientScenario(
  db: InstantReactWebDatabase<AppSchema>,
): CodexStepsController {
  const scenario = fixture as ScenarioFixture;
  const [status, setStatus] = useState<CodexStepsController["status"]>("bootstrapping");
  const [contextId, setContextId] = useState<string | null>(null);

  const runCounterRef = useRef(0);
  const runAbortControllerRef = useRef<AbortController | null>(null);

  const startScenario = useCallback(async () => {
    const runToken = runCounterRef.current + 1;
    runCounterRef.current = runToken;
    runAbortControllerRef.current?.abort();

    const abortController = new AbortController();
    runAbortControllerRef.current = abortController;
    setStatus("bootstrapping");
    setContextId(null);

    const idsBase = {
      contextId: makeUuid(),
      triggerEventId: makeUuid(),
      reactionEventId: makeUuid(),
      executionId: makeUuid(),
      stepId: makeUuid(),
    };

    const triggerEvent = buildTriggerEvent(idsBase.triggerEventId, scenario.request.prompt);
    const reactionEvent = buildPendingReactionEvent(idsBase.reactionEventId);
    const { id: _triggerEventId, ...triggerEventAttrs } = triggerEvent;
    const { id: _reactionEventId, ...reactionEventAttrs } = reactionEvent;

    try {
      await db.transact([
        db.tx.event_contexts[idsBase.contextId].create({
          createdAt: new Date(),
          updatedAt: new Date(),
          key: undefined,
          status: "open_streaming",
          content: {
            source: "registry.codex-steps.client",
          },
        }),
        db.tx.event_items[idsBase.triggerEventId]
          .update({
            ...triggerEventAttrs,
            status: "stored",
          })
          .link({ context: idsBase.contextId }),
        db.tx.event_items[idsBase.reactionEventId]
          .update({
            ...reactionEventAttrs,
          })
          .link({ context: idsBase.contextId }),
        db.tx.event_executions[idsBase.executionId]
          .create({
            createdAt: new Date(),
            updatedAt: new Date(),
            status: "executing",
          })
          .link({
            context: idsBase.contextId,
            trigger: idsBase.triggerEventId,
            reaction: idsBase.reactionEventId,
          }),
        db.tx.event_contexts[idsBase.contextId]
          .update({
            status: "open_streaming",
            updatedAt: new Date(),
          })
          .link({ currentExecution: idsBase.executionId }),
        db.tx.event_steps[idsBase.stepId]
          .create({
            createdAt: new Date(),
            updatedAt: new Date(),
            status: "running",
            iteration: 0,
          })
          .link({ execution: idsBase.executionId }),
      ] as any);

      const stream = await createClientPersistedStepStream({
        db,
        executionId: idsBase.executionId,
        stepId: idsBase.stepId,
      });
      const ids: ScenarioIds = {
        ...idsBase,
        streamId: stream.streamId,
        streamClientId: stream.streamClientId,
      };
      const chunks: Array<Record<string, unknown>> = [];

      if (runCounterRef.current !== runToken || abortController.signal.aborted) {
        throw new Error("scenario_aborted");
      }

      setContextId(ids.contextId);
      setStatus("streaming");

      try {
        for (let index = 0; index < scenario.notifications.length; index += 1) {
          const step = scenario.notifications[index];
          await wait(step.delayMs, abortController.signal);
          const mapped = mapCodexAppServerNotification(step.notification);
          if (!mapped || mapped.skip) continue;
          const chunk = createPersistedStepStreamChunk({
            at: nowIso(),
            sequence: chunks.length + 1,
            chunkType: mapped.chunkType,
            providerChunkType: mapped.providerChunkType,
            actionRef: asString(mapped.actionRef) || undefined,
            data: mapped.data,
          });
          chunks.push(chunk);
          await stream.writer.write(encodePersistedStepStreamChunk(chunk));
        }

        await stream.writer.close();
        await persistScenarioResult({
          db,
          ids,
          status: "completed",
          abortReason: null,
          chunks,
        });

        if (runCounterRef.current === runToken) {
          setStatus("completed");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const aborted = message === "scenario_aborted" || abortController.signal.aborted;

        try {
          await stream.writer.abort(aborted ? "aborted" : message);
        } catch {}

        await persistScenarioResult({
          db,
          ids,
          status: "failed",
          abortReason: aborted ? "aborted" : message,
          chunks,
        }).catch(() => null);

        if (runCounterRef.current === runToken && !aborted) {
          setStatus("error");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runCounterRef.current === runToken && message !== "scenario_aborted") {
        setStatus("error");
      }
    } finally {
      if (runAbortControllerRef.current === abortController) {
        runAbortControllerRef.current = null;
      }
    }
  }, [db, scenario.notifications, scenario.request.prompt]);

  useEffect(() => {
    void startScenario();
    return () => {
      runAbortControllerRef.current?.abort();
    };
  }, [startScenario]);

  const restart = useCallback(async () => {
    runCounterRef.current += 1;
    runAbortControllerRef.current?.abort();
    void startScenario();
  }, [startScenario]);

  return useCodexStepsController({
    db,
    contextId,
    restart,
    statusOverride: status,
  });
}
