"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type {
  AppendArgs,
  ContextEventForUI,
  ContextValue,
} from "@/components/ekairos/context/context";
import { ASSISTANT_MESSAGE_TYPE, INPUT_TEXT_ITEM_TYPE } from "@/components/ekairos/context/context";

import fixture from "./codex-run.fixture.json";

type FixtureNotificationStep = {
  delayMs: number;
  notification: Record<string, unknown>;
};

type FixtureData = {
  id: string;
  title: string;
  source: {
    runId: string;
    executionId: string;
    contextId: string;
  };
  request: {
    prompt: string;
    runtime: {
      mode: string;
      appServerUrl: string;
      approvalPolicy: string;
    };
  };
  notifications: FixtureNotificationStep[];
  reaction: {
    text: string;
    reasoning: string;
    status: string;
  };
};

type ScriptedContextLifecycleCallbacks = {
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

type CodexChunkMappingResult = {
  skip?: boolean;
  chunkType: string;
  providerChunkType?: string;
  actionRef?: string | null;
  data?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
      return { skip: true, chunkType: "chunk.message_metadata", providerChunkType: method, data: { params } };
  }
}

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

function toOutputState(chunkType: string): "output-streaming" | "output-available" | "output-error" {
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

function toChunkLabel(chunk: CodexChunkMappingResult): string {
  const data = (chunk.data as Record<string, unknown> | undefined) ?? {};
  const params = (data.params as Record<string, unknown> | undefined) ?? {};
  if (chunk.chunkType === "chunk.start") return "Turn started";
  if (chunk.chunkType === "chunk.finish") return "Turn completed";
  if (chunk.chunkType === "chunk.text_start") return "assistant text started";
  if (chunk.chunkType === "chunk.text_end") return "assistant text completed";
  if (chunk.chunkType === "chunk.reasoning_start") return "reasoning started";
  if (chunk.chunkType === "chunk.reasoning_end") return "reasoning completed";
  if (chunk.chunkType === "chunk.text_delta") {
    const delta = typeof params.delta === "string" ? params.delta : "";
    return delta || "assistant text delta";
  }
  if (chunk.chunkType === "chunk.reasoning_delta") {
    const delta = typeof params.delta === "string" ? params.delta : "";
    return delta || "reasoning delta";
  }
  if (chunk.providerChunkType) return chunk.providerChunkType;
  return chunk.chunkType;
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

function createCodexStreamEvent(params: {
  contextId: string;
  executionId: string;
  runId: string;
  chunk: CodexChunkMappingResult;
  sequence: number;
}): ContextEventForUI {
  const eventId = makeId(`codex-stream-${params.sequence}`);
  const label = toChunkLabel(params.chunk);
  const chunkType = params.chunk.chunkType;
  const providerChunkType = params.chunk.providerChunkType || "unknown";
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
          type: "reactor-event",
          state: toOutputState(chunkType),
          input: payload,
          output: payload,
          metadata: {
            source: "codex.stream.event",
            phase: chunkType,
            label,
            eventType: "reactor-event",
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
          type: "reactor-event",
          state: "output-available",
          input: {
            phase: "turn.completed",
            label: "Turn completed",
          },
          output: {
            phase: "turn.completed",
            label: "Turn completed",
          },
          metadata: {
            source: "codex.stream.event",
            phase: "turn.completed",
            eventType: "reactor-event",
          },
        },
      ],
    },
  };
}

export function useScriptedCodexContext(
  callbacks?: ScriptedContextLifecycleCallbacks,
): ContextValue & {
  reset: () => void;
  title: string;
  profile: {
    reactor: "codex";
    runtimeMode: string;
    provider: string;
    model: string | null;
    appServerUrl: string | null;
    approvalPolicy: string | null;
    contextId: string;
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
    setTurnSubstateKey("code.runtime.connecting");
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
      for (let index = 0; index < data.notifications.length; index += 1) {
        const step = data.notifications[index];
        await wait(step.delayMs);
        if (currentRunRef.current !== runToken) return;

        const mapped = mapCodexAppServerNotification(step.notification);
        if (!mapped || mapped.skip) continue;

        if (mapped.chunkType === "chunk.start") {
          setTurnSubstateKey("code.runtime.ready");
        }
        const streamEvent = createCodexStreamEvent({
          contextId: data.source.contextId,
          executionId: data.source.executionId,
          runId: runId,
          chunk: mapped,
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

  const context = useMemo<
    ContextValue & {
      reset: () => void;
      title: string;
      profile: {
        reactor: "codex";
        runtimeMode: string;
        provider: string;
        model: string | null;
        appServerUrl: string | null;
        approvalPolicy: string | null;
        contextId: string;
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
        reactor: "codex",
        runtimeMode: data.request.runtime.mode,
        provider: "codex-app-server",
        model: null,
        appServerUrl: data.request.runtime.appServerUrl,
        approvalPolicy: data.request.runtime.approvalPolicy,
        contextId: data.source.contextId,
        executionId: data.source.executionId,
        fixtureId: data.id,
      },
    }),
    [append, contextStatus, data.source.contextId, data.title, events, reset, sendError, sendStatus, stop, turnSubstateKey],
  );

  return context;
}
