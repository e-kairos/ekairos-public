"use client";

import type { InstantReactWebDatabase } from "@instantdb/react";
import { useCallback, useEffect, useRef, useState } from "react";
import aiSdkFixture from "@/components/ekairos/agent/mocks/ai-sdk-run.fixture.json";
import codexFixture from "@/components/ekairos/agent/mocks/codex-run.fixture.json";
import type { AppSchema } from "@/instant.schema";
import {
  buildReactorReplayEvent,
  createCanonicalReactorChunk,
  createDemoStepStream,
  nowIso,
  useEventStepsController,
  type EventDemoScenario,
  type EventStepsController,
} from "./event-steps";

export type { EventDemoScenario } from "./event-steps";

type CodexFixture = {
  request: { prompt: string };
  notifications: Array<{ delayMs: number; notification: Record<string, unknown> }>;
};

type AiSdkFixture = {
  request: { prompt: string };
  chunks: Array<{
    delayMs: number;
    chunk: {
      chunkType: string;
      providerChunkType?: string;
      actionRef?: string;
      label?: string;
      text?: string;
      data?: Record<string, unknown>;
    };
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

function buildTriggerEvent(id: string, prompt: string) {
  return {
    id,
    type: "input",
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: { parts: [{ type: "text", text: prompt }] },
  };
}

function buildPendingReactionEvent(id: string) {
  return {
    id,
    type: "output",
    channel: "web",
    createdAt: nowIso(),
    status: "pending",
    content: { parts: [] },
  };
}

function normalizeCodexNotification(notification: Record<string, unknown>, sequence: number) {
  const method = asString(notification.method);
  const params = asRecord(notification.params);
  switch (method) {
    case "context/started":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.message_metadata",
        provider: "codex",
        providerChunkType: method,
        label: "context started",
        data: { contextId: asString(asRecord(params.context).id) || null },
      });
    case "turn/started":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.start",
        provider: "codex",
        providerChunkType: method,
        label: "turn started",
      });
    case "item/started":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.text_start",
        provider: "codex",
        providerChunkType: method,
        label: "message started",
      });
    case "item/agentMessage/delta":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.text_delta",
        provider: "codex",
        providerChunkType: method,
        text: asString(params.delta),
        label: asString(params.delta),
      });
    case "item/completed":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.text_end",
        provider: "codex",
        providerChunkType: method,
        text: asString(asRecord(params.item).text),
        label: "message completed",
      });
    case "context/tokenUsage/updated":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.response_metadata",
        provider: "codex",
        providerChunkType: method,
        label: "token usage updated",
        data: { tokenUsage: asRecord(params.tokenUsage) },
      });
    case "turn/completed":
      return createCanonicalReactorChunk({
        sequence,
        chunkType: "chunk.finish",
        provider: "codex",
        providerChunkType: method,
        label: "turn completed",
      });
    default:
      return null;
  }
}

export const aiSdkEventsScenario: EventDemoScenario = {
  id: "events-ai-sdk-demo",
  title: "AI SDK",
  subtitle: "Canonical `events` domain demo populated from an AI SDK-shaped chunk stream.",
  reactor: "ai-sdk",
  prompt: (aiSdkFixture as AiSdkFixture).request.prompt,
  chunks: (aiSdkFixture as AiSdkFixture).chunks.map((step, index) => ({
    delayMs: step.delayMs,
    chunk: {
      chunkType: step.chunk.chunkType,
      provider: "ai-sdk",
      providerChunkType: step.chunk.providerChunkType,
      actionRef: step.chunk.actionRef || null,
      label: step.chunk.label,
      text: step.chunk.text,
      data: step.chunk.data,
    },
  })),
};

export const codexEventsScenario: EventDemoScenario = {
  id: "events-codex-demo",
  title: "Codex",
  subtitle: "Canonical `events` domain demo populated from a Codex-shaped notification stream.",
  reactor: "codex",
  prompt: (codexFixture as CodexFixture).request.prompt,
  chunks: (codexFixture as CodexFixture).notifications
    .map((step, index) => {
      const chunk = normalizeCodexNotification(step.notification, index + 1);
      if (!chunk) return null;
      return {
        delayMs: step.delayMs,
        chunk: {
          chunkType: chunk.chunkType,
          provider: "codex",
          providerChunkType: chunk.providerChunkType,
          actionRef: chunk.actionRef,
          label: chunk.label,
          text: chunk.text,
          data: chunk.data,
        },
      };
    })
    .filter(Boolean) as EventDemoScenario["chunks"],
};

export const scriptedEventsScenario: EventDemoScenario = {
  id: "events-scripted-demo",
  title: "Scripted",
  subtitle: "Canonical `events` domain demo with a scripted reactor stream.",
  reactor: "scripted",
  prompt: "Replay a scripted summary of the current event domain.",
  chunks: [
    {
      delayMs: 120,
      chunk: {
        chunkType: "chunk.start",
        provider: "scripted",
        providerChunkType: "scripted/turn.started",
        label: "turn started",
      },
    },
    {
      delayMs: 100,
      chunk: {
        chunkType: "chunk.reasoning_start",
        provider: "scripted",
        providerChunkType: "scripted/reasoning.start",
        label: "reasoning started",
      },
    },
    {
      delayMs: 110,
      chunk: {
        chunkType: "chunk.reasoning_delta",
        provider: "scripted",
        providerChunkType: "scripted/reasoning.delta",
        text: "Inspecting context, executions, steps, and persisted parts.",
        label: "reasoning delta",
      },
    },
    {
      delayMs: 100,
      chunk: {
        chunkType: "chunk.reasoning_end",
        provider: "scripted",
        providerChunkType: "scripted/reasoning.end",
        label: "reasoning completed",
      },
    },
    {
      delayMs: 90,
      chunk: {
        chunkType: "chunk.text_start",
        provider: "scripted",
        providerChunkType: "scripted/message.start",
        label: "message started",
      },
    },
    {
      delayMs: 90,
      chunk: {
        chunkType: "chunk.text_delta",
        provider: "scripted",
        providerChunkType: "scripted/message.delta",
        text: "Scripted demo confirms the same `events` UI can render without provider-specific parts.",
        label: "message delta",
      },
    },
    {
      delayMs: 90,
      chunk: {
        chunkType: "chunk.response_metadata",
        provider: "scripted",
        providerChunkType: "scripted/usage.updated",
        label: "token usage updated",
        data: {
          tokenUsage: {
            total: {
              totalTokens: 84,
              inputTokens: 63,
              outputTokens: 21,
            },
          },
        },
      },
    },
    {
      delayMs: 90,
      chunk: {
        chunkType: "chunk.text_end",
        provider: "scripted",
        providerChunkType: "scripted/message.end",
        label: "message completed",
      },
    },
    {
      delayMs: 90,
      chunk: {
        chunkType: "chunk.finish",
        provider: "scripted",
        providerChunkType: "scripted/turn.completed",
        label: "turn completed",
      },
    },
  ],
};

async function persistScenarioResult(params: {
  db: InstantReactWebDatabase<AppSchema>;
  ids: {
    contextId: string;
    reactionEventId: string;
    executionId: string;
    stepId: string;
    streamId: string;
    streamClientId: string;
  };
  status: "completed" | "failed";
  abortReason: string | null;
  chunks: Array<Record<string, unknown>>;
}) {
  const replay = buildReactorReplayEvent({
    eventId: params.ids.reactionEventId,
    createdAt: nowIso(),
    chunks: params.chunks,
  });
  const persistedParts = replay.event.content.parts;

  const txs: any[] = [
    params.db.tx.event_items[params.ids.reactionEventId].update({
      id: params.ids.reactionEventId,
      type: "output",
      channel: "web",
      createdAt: nowIso(),
      status: params.status === "completed" ? "completed" : "error",
      content: { parts: persistedParts },
    }),
    params.db.tx.event_steps[params.ids.stepId].update({
      status: params.status === "completed" ? "completed" : "failed",
      kind: "message",
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
        source: "registry.events.demo",
      },
    }),
  ];

  persistedParts.forEach((part, idx) => {
    txs.push(
      params.db.tx.event_parts[makeUuid()]
        .create({
          stepId: params.ids.stepId,
          idx,
          key: `${params.ids.stepId}:${idx}`,
          type: asString(asRecord(part).type) || undefined,
          part,
          updatedAt: new Date(),
        })
        .link({ step: params.ids.stepId }),
    );
  });

  await params.db.transact(txs as any);
}

export function useEventDemoScenario(params: {
  db: InstantReactWebDatabase<AppSchema>;
  scenario: EventDemoScenario;
}): EventStepsController {
  const [contextId, setContextId] = useState<string | null>(null);
  const [status, setStatus] = useState<EventStepsController["status"]>("bootstrapping");
  const runCounterRef = useRef(0);
  const runAbortControllerRef = useRef<AbortController | null>(null);

  const startScenario = useCallback(async () => {
    const runToken = runCounterRef.current + 1;
    runCounterRef.current = runToken;
    runAbortControllerRef.current?.abort();

    const abortController = new AbortController();
    runAbortControllerRef.current = abortController;
    setContextId(null);
    setStatus("bootstrapping");

    const ids = {
      contextId: makeUuid(),
      triggerEventId: makeUuid(),
      reactionEventId: makeUuid(),
      executionId: makeUuid(),
      stepId: makeUuid(),
    };

    try {
      await params.db.transact([
        params.db.tx.event_contexts[ids.contextId].create({
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "open_streaming",
          content: { source: "registry.events.demo" },
        }),
        params.db.tx.event_items[ids.triggerEventId]
          .update({
            ...buildTriggerEvent(ids.triggerEventId, params.scenario.prompt),
            id: ids.triggerEventId,
          })
          .link({ context: ids.contextId }),
        params.db.tx.event_items[ids.reactionEventId]
          .update({
            ...buildPendingReactionEvent(ids.reactionEventId),
            id: ids.reactionEventId,
          })
          .link({ context: ids.contextId }),
        params.db.tx.event_executions[ids.executionId]
          .create({
            createdAt: new Date(),
            updatedAt: new Date(),
            status: "executing",
          })
          .link({
            context: ids.contextId,
            trigger: ids.triggerEventId,
            reaction: ids.reactionEventId,
          }),
        params.db.tx.event_contexts[ids.contextId]
          .update({ status: "open_streaming", updatedAt: new Date() })
          .link({ currentExecution: ids.executionId }),
        params.db.tx.event_steps[ids.stepId]
          .create({
            createdAt: new Date(),
            updatedAt: new Date(),
            status: "running",
            iteration: 0,
            kind: "message",
          })
          .link({ execution: ids.executionId }),
      ] as any);

      const stream = await createDemoStepStream({
        db: params.db,
        executionId: ids.executionId,
        stepId: ids.stepId,
      });
      const streamIds = {
        ...ids,
        streamId: stream.streamId,
        streamClientId: stream.streamClientId,
      };
      const chunks: Array<Record<string, unknown>> = [];
      setContextId(ids.contextId);
      setStatus("streaming");

      try {
        for (let index = 0; index < params.scenario.chunks.length; index += 1) {
          const row = params.scenario.chunks[index]!;
          await wait(row.delayMs, abortController.signal);
          const chunk = createCanonicalReactorChunk({
            ...row.chunk,
            sequence: index + 1,
          });
          chunks.push(chunk);
          await stream.write(chunk);
        }

        await stream.writer.close();
        await persistScenarioResult({
          db: params.db,
          ids: streamIds,
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
          db: params.db,
          ids: streamIds,
          status: "failed",
          abortReason: aborted ? "aborted" : message,
          chunks,
        }).catch(() => null);
        if (runCounterRef.current === runToken && !aborted) {
          setStatus("error");
        }
      }
    } catch {
      if (runCounterRef.current === runToken) {
        setStatus("error");
      }
    } finally {
      if (runAbortControllerRef.current === abortController) {
        runAbortControllerRef.current = null;
      }
    }
  }, [params.db, params.scenario]);

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

  return useEventStepsController({
    db: params.db,
    contextId,
    restart,
    statusOverride: status,
  });
}
