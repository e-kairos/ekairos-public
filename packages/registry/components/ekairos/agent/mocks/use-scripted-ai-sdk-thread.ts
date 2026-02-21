"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type {
  AppendArgs,
  ContextEventForUI,
  ThreadValue,
} from "@/components/ekairos/thread/context";
import { ASSISTANT_MESSAGE_TYPE, INPUT_TEXT_ITEM_TYPE } from "@/components/ekairos/thread/context";

import fixture from "./ai-sdk-run.fixture.json";

type FixtureChunk = {
  chunkType: string;
  providerChunkType?: string;
  actionRef?: string;
  label?: string;
  text?: string;
  state?: string;
  data?: Record<string, unknown>;
};

type FixtureChunkStep = {
  delayMs: number;
  chunk: FixtureChunk;
};

type FixtureData = {
  id: string;
  title: string;
  source: {
    runId: string;
    executionId: string;
    contextId: string;
    threadId: string;
  };
  request: {
    prompt: string;
    runtime: {
      mode: string;
      provider: string;
      model: string;
    };
  };
  chunks: FixtureChunkStep[];
  reaction: {
    text: string;
    reasoning: string;
    status: string;
  };
};

type ScriptedThreadLifecycleCallbacks = {
  onRunStart?: (params: {
    runId: string;
    prompt: string;
    contextId: string;
    fixture: FixtureData;
  }) => Promise<void> | void;
  onEvent?: (params: {
    runId: string;
    sequence: number;
    event: ContextEventForUI;
    contextId: string;
    fixture: FixtureData;
  }) => Promise<void> | void;
  onRunFinish?: (params: {
    runId: string;
    contextId: string;
    fixture: FixtureData;
    status: "completed" | "stopped" | "error";
    error?: string;
  }) => Promise<void> | void;
  onReset?: (params: { contextId: string; fixture: FixtureData }) => Promise<void> | void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeId(prefix: string): string {
  const maybeUuid = globalThis.crypto?.randomUUID?.();
  if (typeof maybeUuid === "string" && maybeUuid.length > 0) {
    return `${prefix}:${maybeUuid}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function makeRunId(): string {
  const maybeUuid = globalThis.crypto?.randomUUID?.();
  if (typeof maybeUuid === "string" && maybeUuid.length > 0) {
    return `run:${maybeUuid}`;
  }
  return `run:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function extractPromptText(parts: any[]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const rec = part as Record<string, unknown>;
      return typeof rec.text === "string" ? rec.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toOutputState(chunkType: string, state?: string): "output-streaming" | "output-available" | "output-error" {
  if (state === "output-error") return "output-error";
  if (state === "output-available") return "output-available";
  if (chunkType === "chunk.error" || chunkType.endsWith("_error")) return "output-error";
  if (
    chunkType === "chunk.finish" ||
    chunkType === "chunk.text_end" ||
    chunkType === "chunk.reasoning_end" ||
    chunkType === "chunk.action_output_available" ||
    chunkType === "chunk.response_metadata" ||
    chunkType === "chunk.message_metadata"
  ) {
    return "output-available";
  }
  return "output-streaming";
}

function createUserEvent(text: string): ContextEventForUI {
  return {
    id: makeId("user"),
    type: INPUT_TEXT_ITEM_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  };
}

function createAiSdkStreamEvent(params: {
  contextId: string;
  executionId: string;
  runId: string;
  chunk: FixtureChunk;
  sequence: number;
}): ContextEventForUI {
  const eventId = makeId(`ai-sdk-stream-${params.sequence}`);
  const chunkType = String(params.chunk.chunkType || "chunk.message_metadata");
  const providerChunkType = String(params.chunk.providerChunkType || "ai-sdk/unknown");
  const label = String(params.chunk.label || params.chunk.text || chunkType);
  const payload = {
    phase: chunkType,
    label,
    eventId,
    stepId: null,
    detail: {
      contextId: params.contextId,
      executionId: params.executionId,
      runId: params.runId,
      chunkType,
      providerChunkType,
      actionRef: params.chunk.actionRef ?? null,
      chunkData: params.chunk.data ?? null,
    },
    at: nowIso(),
  };

  return {
    id: eventId,
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: {
      parts: [
        {
          type: "ai-sdk-event",
          state: toOutputState(chunkType, params.chunk.state),
          input: payload,
          output: payload,
          metadata: {
            source: "ai-sdk.stream.chunk",
            phase: chunkType,
            label,
            eventType: "ai-sdk-event",
            sequence: params.sequence,
            chunkType,
            providerChunkType,
            actionRef: params.chunk.actionRef ?? null,
          },
        },
      ],
    },
  };
}

function createReactionEvent(data: FixtureData): ContextEventForUI {
  return {
    id: makeId("reaction"),
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: data.reaction.status,
    content: {
      parts: [
        {
          type: "reasoning",
          text: data.reaction.reasoning,
        },
        {
          type: "text",
          text: data.reaction.text,
        },
        {
          type: "ai-sdk-event",
          state: "output-available",
          input: {
            phase: "chunk.finish",
            label: "Turn completed",
          },
          output: {
            phase: "chunk.finish",
            label: "Turn completed",
          },
          metadata: {
            source: "ai-sdk.stream.chunk",
            phase: "chunk.finish",
            eventType: "ai-sdk-event",
          },
        },
      ],
    },
  };
}

export function useScriptedAiSdkThread(
  callbacks?: ScriptedThreadLifecycleCallbacks,
): ThreadValue & {
  reset: () => void;
  title: string;
  profile: {
    reactor: "ai_sdk";
    runtimeMode: string;
    provider: string;
    model: string | null;
    appServerUrl: string | null;
    approvalPolicy: string | null;
    threadId: string;
    executionId: string;
    fixtureId: string;
  };
} {
  const data = fixture as FixtureData;
  const [events, setEvents] = useState<ContextEventForUI[]>([]);
  const [contextStatus, setContextStatus] = useState<"open" | "streaming" | "closed">("open");
  const [sendStatus, setSendStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);
  const currentRunRef = useRef(0);
  const currentRunIdRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    const currentRunId = currentRunIdRef.current;
    currentRunRef.current += 1;
    setContextStatus("open");
    setSendStatus("idle");
    setTurnSubstateKey(null);
    currentRunIdRef.current = null;
    if (currentRunId) {
      void callbacks?.onRunFinish?.({
        runId: currentRunId,
        contextId: data.source.contextId,
        fixture: data,
        status: "stopped",
      });
    }
  }, [callbacks, data]);

  const reset = useCallback(() => {
    stop();
    setEvents([]);
    setSendError(null);
    void callbacks?.onReset?.({
      contextId: data.source.contextId,
      fixture: data,
    });
  }, [stop]);

  const append = useCallback(async (args: AppendArgs) => {
    if (sendStatus === "submitting") return;
    const promptText = extractPromptText(args.parts) || data.request.prompt;

    const runToken = currentRunRef.current + 1;
    currentRunRef.current = runToken;
    const runId = makeRunId();
    currentRunIdRef.current = runId;

    setSendError(null);
    setSendStatus("submitting");
    setContextStatus("streaming");
    setTurnSubstateKey("thread.loop.running");
    const userEvent = createUserEvent(promptText);
    setEvents((prev) => [...prev, userEvent]);
    await callbacks?.onRunStart?.({
      runId,
      prompt: promptText,
      contextId: data.source.contextId,
      fixture: data,
    });
    await callbacks?.onEvent?.({
      runId,
      sequence: 0,
      event: userEvent,
      contextId: data.source.contextId,
      fixture: data,
    });

    try {
      let emittedSequence = 1;
      for (let index = 0; index < data.chunks.length; index += 1) {
        const step = data.chunks[index];
        await wait(step.delayMs);
        if (currentRunRef.current !== runToken) return;

        const streamEvent = createAiSdkStreamEvent({
          contextId: data.source.contextId,
          executionId: data.source.executionId,
          runId: runId,
          chunk: step.chunk,
          sequence: emittedSequence,
        });
        setEvents((prev) => [...prev, streamEvent]);
        await callbacks?.onEvent?.({
          runId,
          sequence: emittedSequence,
          event: streamEvent,
          contextId: data.source.contextId,
          fixture: data,
        });
        emittedSequence += 1;
      }

      if (currentRunRef.current !== runToken) return;
      const reactionEvent = createReactionEvent(data);
      setEvents((prev) => [...prev, reactionEvent]);
      await callbacks?.onEvent?.({
        runId,
        sequence: emittedSequence,
        event: reactionEvent,
        contextId: data.source.contextId,
        fixture: data,
      });
      setContextStatus("open");
      setSendStatus("idle");
      setTurnSubstateKey(null);
      currentRunIdRef.current = null;
      await callbacks?.onRunFinish?.({
        runId,
        contextId: data.source.contextId,
        fixture: data,
        status: "completed",
      });
    } catch (error) {
      if (currentRunRef.current !== runToken) return;
      setSendStatus("error");
      setContextStatus("open");
      setTurnSubstateKey(null);
      currentRunIdRef.current = null;
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSendError(errorMessage);
      await callbacks?.onRunFinish?.({
        runId,
        contextId: data.source.contextId,
        fixture: data,
        status: "error",
        error: errorMessage,
      });
    }
  }, [callbacks, data, sendStatus]);

  return useMemo<
    ThreadValue & {
      reset: () => void;
      title: string;
      profile: {
        reactor: "ai_sdk";
        runtimeMode: string;
        provider: string;
        model: string | null;
        appServerUrl: string | null;
        approvalPolicy: string | null;
        threadId: string;
        executionId: string;
        fixtureId: string;
      };
    }
  >(
    () => ({
      apiUrl: "/api/code/agent",
      contextId: data.source.contextId,
      contextStatus,
      turnSubstateKey,
      events,
      sendStatus,
      sendError,
      stop,
      append,
      reset,
      title: data.title,
      profile: {
        reactor: "ai_sdk",
        runtimeMode: data.request.runtime.mode,
        provider: data.request.runtime.provider,
        model: data.request.runtime.model,
        appServerUrl: null,
        approvalPolicy: null,
        threadId: data.source.threadId,
        executionId: data.source.executionId,
        fixtureId: data.id,
      },
    }),
    [append, contextStatus, data.source.contextId, data.title, events, reset, sendError, sendStatus, stop, turnSubstateKey],
  );
}
