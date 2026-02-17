"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { id } from "@instantdb/react";
import { parse as parsePartialJson, Allow as PartialJsonAllow } from "partial-json";

import {
  ASSISTANT_MESSAGE_TYPE,
  USER_MESSAGE_TYPE,
  type AppendArgs,
  type ContextEventForUI,
  type ContextStatus,
  type SendStatus,
  type StoryValue,
  type UseStoryContextHook,
  type UseStoryEventsHook,
  type UseStoryOptions,
} from "./types";

type ResumableStorageKind = "assistant-message-id" | "run-id" | "chunk-index";
type EphemeralEvent = ContextEventForUI & { __contextId: string | null };

type StreamingAccumulator = {
  contextId: string | null;
  messageId: string | null;
  text: string;
  reasoning: string;
  sources: Array<{ sourceId: string; url: string; title?: string }>;
  toolCalls: Record<
    string,
    {
      toolCallId: string;
      toolName: string;
      inputText: string;
      input?: any;
      output?: any;
      errorText?: string;
      state?: string;
    }
  >;
};

function makeStorageKey(apiUrl: string) {
  const prefix = `ekairos-story:context:${apiUrl}`;
  return function keyFor(kind: ResumableStorageKind, contextId: string | null) {
    return `${prefix}:${kind}:${contextId || "active"}`;
  };
}

function mergeEvents(params: {
  persisted: ContextEventForUI[];
  optimistic: EphemeralEvent[];
  streamingAssistant: EphemeralEvent | null;
  currentContextId: string | null;
}): ContextEventForUI[] {
  const persisted = params.persisted;

  const byId = new Map<string, ContextEventForUI>();
  for (const ev of persisted) byId.set(String(ev?.id), ev);

  const merged: ContextEventForUI[] = [...persisted];

  // 1) Optimistic user events — only for the active context; hide once persisted exists
  for (const ev of params.optimistic) {
    const belongsToActive =
      String(ev.__contextId) === String(params.currentContextId) ||
      (ev.__contextId == null && params.currentContextId != null);
    if (!belongsToActive) continue;
    const id = String(ev?.id);
    if (!id) continue;
    if (byId.has(id)) continue;
    merged.push(ev);
  }

  // 2) Streaming assistant overlay — only for the active context
  const streaming = params.streamingAssistant;
  const streamingBelongsToActive =
    streaming &&
    (String(streaming.__contextId) === String(params.currentContextId) ||
      (streaming.__contextId == null && params.currentContextId != null));
  if (streaming && streamingBelongsToActive) {
    const sid = String(streaming.id);
    const persistedEvent = byId.get(sid);
    if (!persistedEvent) {
      merged.push(streaming);
    } else {
      const status = (persistedEvent as any)?.status;
      const shouldOverlay = status !== "completed";

      if (shouldOverlay) {
        const mergedParts: any[] = Array.isArray(persistedEvent.content?.parts)
          ? [...persistedEvent.content.parts]
          : [];

        const streamingParts: any[] = Array.isArray(streaming.content?.parts)
          ? streaming.content.parts
          : [];

        const streamingText = streamingParts.find((p: any) => p?.type === "text");
        if (streamingText && typeof streamingText.text === "string") {
          const persistedTextIdx = mergedParts.findIndex((p: any) => p?.type === "text");
          if (persistedTextIdx === -1) {
            mergedParts.push({ type: "text", text: streamingText.text });
          } else {
            const persistedText = mergedParts[persistedTextIdx];
            const persistedStr =
              persistedText && typeof persistedText.text === "string"
                ? persistedText.text
                : "";
            if (streamingText.text.length >= persistedStr.length) {
              mergedParts[persistedTextIdx] = {
                ...persistedText,
                type: "text",
                text: streamingText.text,
              };
            }
          }
        }

        const streamingReasoning = streamingParts.find(
          (p: any) => p?.type === "reasoning"
        );
        if (streamingReasoning && typeof streamingReasoning.text === "string") {
          const persistedReasonIdx = mergedParts.findIndex(
            (p: any) => p?.type === "reasoning"
          );
          if (persistedReasonIdx === -1) {
            mergedParts.unshift({ type: "reasoning", text: streamingReasoning.text });
          } else {
            const persistedReason = mergedParts[persistedReasonIdx];
            const persistedStr =
              persistedReason && typeof persistedReason.text === "string"
                ? persistedReason.text
                : "";
            if (streamingReasoning.text.length >= persistedStr.length) {
              mergedParts[persistedReasonIdx] = {
                ...persistedReason,
                type: "reasoning",
                text: streamingReasoning.text,
              };
            }
          }
        }

        const existingSourceUrls = new Set(
          mergedParts
            .filter((p: any) => p?.type === "source-url" && typeof p?.url === "string")
            .map((p: any) => String(p.url))
        );
        for (const sp of streamingParts) {
          if (sp?.type !== "source-url" || typeof sp?.url !== "string") continue;
          const url = String(sp.url);
          if (existingSourceUrls.has(url)) continue;
          mergedParts.push(sp);
          existingSourceUrls.add(url);
        }

        const mergedEvent: ContextEventForUI = {
          ...persistedEvent,
          content: { ...(persistedEvent.content as any), parts: mergedParts },
        };

        const idx = merged.findIndex((m: any) => String(m?.id) === sid);
        if (idx >= 0) merged[idx] = mergedEvent;
      }
    }
  }

  return merged;
}

const useDefaultContext: UseStoryContextHook = (db, { contextId }) => {
  const contextRes = db.useQuery(
    (contextId
      ? {
          context_contexts: {
            $: { where: { id: contextId as any }, limit: 1 },
          },
        }
      : null) as any
  );

  const ctx = (contextRes as any)?.data?.context_contexts?.[0] ?? null;
  const contextStatus = ((ctx?.status as ContextStatus) || "open") as ContextStatus;

  return { context: ctx, contextStatus };
};

const useDefaultEvents: UseStoryEventsHook = (db, { contextId }) => {
  const eventsRes = db.useQuery(
    (contextId
      ? {
          context_events: {
            $: {
              where: { "context.id": contextId as any },
              order: { createdAt: "asc" },
            },
          },
        }
      : null) as any
  );

  const raw = (eventsRes as any)?.data?.context_events ?? [];
  return { events: Array.isArray(raw) ? (raw as ContextEventForUI[]) : [] };
};

export function useStory(db: any, opts: UseStoryOptions): StoryValue {
  const {
    apiUrl,
    initialContextId,
    onContextUpdate,
    enableResumableStreams = false,
    context: useContextImpl = useDefaultContext,
    events: useEventsImpl = useDefaultEvents,
  } = opts;

  const [contextId, setContextId] = useState<string | null>(initialContextId || null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [optimisticEvents, setOptimisticEvents] = useState<EphemeralEvent[]>([]);
  const [streamingAssistantEvent, setStreamingAssistantEvent] =
    useState<EphemeralEvent | null>(null);

  const streamingRef = useRef<StreamingAccumulator>({
    contextId: initialContextId || null,
    messageId: null,
    text: "",
    reasoning: "",
    sources: [],
    toolCalls: {},
  });

  useEffect(() => {
    setContextId(initialContextId || null);
  }, [initialContextId]);

  useEffect(() => {
    streamingRef.current.contextId = contextId;
  }, [contextId]);

  const handleContextUpdate = useCallback(
    (nextId: string) => {
      setContextId(nextId);
      onContextUpdate?.(nextId);
    },
    [onContextUpdate]
  );

  // IMPORTANT: Both overrides are hooks (they call db.useQuery). We invoke them deterministically.
  const { contextStatus } = useContextImpl(db, { contextId });
  const { events: persistedEventsUnsorted } = useEventsImpl(db, { contextId });

  // PERF: sorting and merging can be O(n log n) / O(n) with allocations.
  // We use useMemo to avoid recomputing on unrelated renders (e.g., prompt input changes).
  // Correctness does NOT depend on memoization (React may discard memoized values).
  const persistedEvents = useMemo(() => {
    const events = Array.isArray(persistedEventsUnsorted)
      ? persistedEventsUnsorted
      : [];

    const parseTs = (raw: unknown): number => {
      if (raw instanceof Date) return raw.getTime();
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string") {
        const n = new Date(raw).getTime();
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };

    return events
      .slice()
      .sort((a: any, b: any) => {
        const aMs = parseTs(a?.createdAt);
        const bMs = parseTs(b?.createdAt);
        if (aMs !== bMs) return aMs - bMs;
        return String(a?.id).localeCompare(String(b?.id));
      });
  }, [persistedEventsUnsorted]);

  const mergedEvents = useMemo(
    () =>
      mergeEvents({
        persisted: persistedEvents,
        optimistic: optimisticEvents,
        streamingAssistant: streamingAssistantEvent,
        currentContextId: contextId,
      }),
    [contextId, optimisticEvents, persistedEvents, streamingAssistantEvent]
  );

  const keyFor = useMemo(() => makeStorageKey(apiUrl), [apiUrl]);
  const assistantMessageIdKeyFor = useCallback(
    (ctx: string | null) => keyFor("assistant-message-id", ctx),
    [keyFor]
  );
  const runIdKeyFor = useCallback((ctx: string | null) => keyFor("run-id", ctx), [keyFor]);
  const chunkIndexKeyFor = useCallback(
    (ctx: string | null) => keyFor("chunk-index", ctx),
    [keyFor]
  );

  const readChunkIndex = useCallback(
    (ctx: string | null): number => {
      if (typeof window === "undefined") return -1;
      const raw =
        window.localStorage.getItem(chunkIndexKeyFor(ctx)) ??
        window.localStorage.getItem(chunkIndexKeyFor("active"));
      const n = raw ? parseInt(raw, 10) : -1;
      return Number.isFinite(n) ? n : -1;
    },
    [chunkIndexKeyFor]
  );

  const writeChunkIndex = useCallback(
    (ctx: string | null, idx: number) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(chunkIndexKeyFor("active"), String(idx));
        if (ctx) window.localStorage.setItem(chunkIndexKeyFor(ctx), String(idx));
      } catch {
        // ignore
      }
    },
    [chunkIndexKeyFor]
  );

  const stop = useCallback(() => {
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }
    abortRef.current = null;
    setSendStatus("idle");
  }, []);

  const readSseAndCaptureContext = useCallback(
    async (res: Response, opts?: { startIndex?: number }) => {
      const body = res.body;
      if (!body) return;
      const decoder = new TextDecoder();
      const reader = body.getReader();
      let buffer = "";
      let shouldStop = false;

      let currentCtx: string | null = contextId;
      let idx =
        typeof opts?.startIndex === "number"
          ? opts.startIndex - 1
          : readChunkIndex(currentCtx);

      const buildStreamingAssistantEvent = (
        assistantMessageId: string,
        ctx: string | null
      ): EphemeralEvent => {
        const acc = streamingRef.current;
        const parts: any[] = [];
        if (acc.reasoning && acc.reasoning.trim().length > 0) {
          parts.push({ type: "reasoning", text: acc.reasoning });
        }
        if (acc.text && acc.text.length > 0) {
          parts.push({ type: "text", text: acc.text });
        }
        for (const s of acc.sources) {
          parts.push({
            type: "source-url",
            sourceId: s.sourceId,
            url: s.url,
            ...(s.title ? { title: s.title } : {}),
          });
        }

        // Tool input/output streaming (best-effort).
        // We materialize these as `tool-*` parts so Agent rendering can show them,
        // and so `createMessage` can render as a message while its args stream in.
        for (const tc of Object.values(acc.toolCalls || {})) {
          parts.push({
            type: `tool-${tc.toolName}`,
            toolCallId: tc.toolCallId,
            input: tc.input,
            // some tool renderers also look at `args`
            args: tc.input,
            output: tc.output,
            errorText: tc.errorText,
            state: tc.state,
            inputText: tc.inputText,
          });
        }

        return {
          __contextId: ctx,
          id: assistantMessageId,
          type: ASSISTANT_MESSAGE_TYPE,
          channel: "web",
          createdAt: new Date().toISOString(),
          content: { parts },
        };
      };

      const getActiveAssistantMessageId = (): string | null => {
        const current = streamingRef.current.messageId;
        if (current) return current;
        if (!enableResumableStreams) return null;
        if (typeof window === "undefined") return null;
        try {
          const stored =
            window.localStorage.getItem(assistantMessageIdKeyFor(currentCtx)) ??
            window.localStorage.getItem(assistantMessageIdKeyFor("active"));
          if (stored && stored.length > 0) {
            streamingRef.current.messageId = stored;
            return stored;
          }
        } catch {
          // ignore
        }
        return null;
      };

      const setActiveAssistantMessageId = (assistantMessageId: string) => {
        if (!assistantMessageId) return;
        if (streamingRef.current.messageId !== assistantMessageId) {
          streamingRef.current = {
            contextId: streamingRef.current.contextId,
            messageId: assistantMessageId,
            text: "",
            reasoning: "",
            sources: [],
            toolCalls: {},
          };
        }
        if (enableResumableStreams && typeof window !== "undefined") {
          try {
            window.localStorage.setItem(
              assistantMessageIdKeyFor("active"),
              assistantMessageId
            );
            if (currentCtx) {
              window.localStorage.setItem(
                assistantMessageIdKeyFor(currentCtx),
                assistantMessageId
              );
            }
          } catch {
            // ignore
          }
        }
      };

      const setActiveContextForEphemeral = (cid: string) => {
        streamingRef.current.contextId = cid;
        setOptimisticEvents((prev) =>
          prev.map((ev) => (ev.__contextId === null ? { ...ev, __contextId: cid } : ev))
        );
        setStreamingAssistantEvent((prev) =>
          prev && prev.__contextId === null ? { ...prev, __contextId: cid } : prev
        );
      };

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const payload = trimmed.slice("data:".length).trim();
        if (!payload) return;
        if (payload === "[DONE]") {
          // The AI stream signaled completion; don't wait for the server to close the socket.
          shouldStop = true;
          return;
        }

        try {
          const parsed = JSON.parse(payload) as any;

          // Workflow durable streams may serialize chunks in a compact "table" form:
          //   [ { type: 1, ... }, "finish", ... ]
          // where numeric values point into the surrounding array.
          // Normalize those payloads back into the plain `{ type: "..." }` object shape
          // expected by the rest of this parser.
          const normalizeChunk = (value: any): any => {
            // Sometimes the chunk may be a string with a leading NUL marker.
            if (typeof value === "string" && value.startsWith("\u0000[")) {
              try {
                value = JSON.parse(value.slice(1));
              } catch {
                // ignore
              }
            }

            if (!Array.isArray(value)) return value;
            const table = value;
            const root = table[0];
            if (!root || typeof root !== "object" || Array.isArray(root)) return value;

            const decodeNode = (node: any): any => {
              if (typeof node === "number" && Number.isInteger(node)) {
                if (node >= 0 && node < table.length) return decodeNode(table[node]);
                return node;
              }
              if (!node || typeof node !== "object") return node;
              if (Array.isArray(node)) return node.map(decodeNode);
              const out: any = {};
              for (const [k, v] of Object.entries(node)) {
                out[k] = decodeNode(v);
              }
              return out;
            };

            return decodeNode(root);
          };

          const obj = normalizeChunk(parsed);
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;

          // Track chunk index for resumable streams
          idx += 1;
          if (enableResumableStreams) writeChunkIndex(currentCtx, idx);

          // Capture assistant message id (eventId) for local streaming UX
          if (
            obj.type === "start" ||
            obj.type === "finish" ||
            obj.type === "message-metadata"
          ) {
            const mid = typeof obj.messageId === "string" ? (obj.messageId as string) : null;
            const meta = obj.messageMetadata;
            const metaEventId =
              meta &&
              typeof meta === "object" &&
              typeof (meta as any).eventId === "string"
                ? String((meta as any).eventId)
                : null;
            const nextAssistantMessageId = metaEventId || mid;
            if (typeof nextAssistantMessageId === "string") {
              setActiveAssistantMessageId(nextAssistantMessageId);
            }
          }

          // Streaming text/reasoning/sources
          if (obj.type === "text-delta" && typeof obj.delta === "string") {
            const assistantId = getActiveAssistantMessageId();
            if (assistantId) {
              streamingRef.current.text += obj.delta;
              setStreamingAssistantEvent(
                buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
              );
            }
          }
          if (obj.type === "reasoning-delta" && typeof obj.delta === "string") {
            const assistantId = getActiveAssistantMessageId();
            if (assistantId) {
              streamingRef.current.reasoning += obj.delta;
              setStreamingAssistantEvent(
                buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
              );
            }
          }
          if (obj.type === "source-url" && typeof obj.url === "string") {
            const assistantId = getActiveAssistantMessageId();
            if (assistantId) {
              const url = String(obj.url);
              const exists = streamingRef.current.sources.some((s) => s.url === url);
              if (!exists) {
                streamingRef.current.sources.push({
                  sourceId: typeof obj.sourceId === "string" ? String(obj.sourceId) : url,
                  url,
                  ...(typeof obj.title === "string" ? { title: obj.title } : {}),
                });
              }
              setStreamingAssistantEvent(
                buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
              );
            }
          }
          // Tool argument streaming (AI SDK emits tool-input-* chunks when the model is "calling" a tool).
          // This is what we need to show progressive output when the model uses tools instead of `text-delta`.
          if (obj.type === "tool-input-start") {
            const toolCallId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
            const toolName = typeof obj.toolName === "string" ? obj.toolName : "";
            if (toolCallId && toolName) {
              streamingRef.current.toolCalls[toolCallId] = {
                toolCallId,
                toolName,
                inputText: "",
                state: "input-streaming",
              };
            }
          }
          if (obj.type === "tool-input-delta") {
            const toolCallId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
            const delta = typeof obj.inputTextDelta === "string" ? obj.inputTextDelta : "";
            const existing = toolCallId ? streamingRef.current.toolCalls[toolCallId] : null;
            if (existing && delta) {
              existing.inputText += delta;

              // Best-effort partial JSON parsing for streaming tool args.
              // (User asked explicitly to use a library for this.)
              try {
                const parsedInput = parsePartialJson(
                  existing.inputText,
                  PartialJsonAllow.OBJ |
                    PartialJsonAllow.ARR |
                    PartialJsonAllow.STR |
                    PartialJsonAllow.NUM |
                    PartialJsonAllow.BOOL |
                    PartialJsonAllow.NULL
                );
                existing.input = parsedInput;
              } catch {
                // Keep raw text until we can parse.
                existing.input = existing.inputText;
              }

              const assistantId = getActiveAssistantMessageId();
              if (assistantId) {
                setStreamingAssistantEvent(
                  buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
                );
              }
            }
          }
          if (obj.type === "tool-input-available") {
            const toolCallId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
            const toolName = typeof obj.toolName === "string" ? obj.toolName : "";
            if (toolCallId && toolName) {
              const entry =
                streamingRef.current.toolCalls[toolCallId] ??
                (streamingRef.current.toolCalls[toolCallId] = {
                  toolCallId,
                  toolName,
                  inputText: "",
                });
              entry.toolName = toolName;
              entry.input = obj.input;
              entry.state = "input-available";
              try {
                entry.inputText =
                  entry.inputText || (obj.input ? JSON.stringify(obj.input) : "");
              } catch {
                // ignore
              }
              const assistantId = getActiveAssistantMessageId();
              if (assistantId) {
                setStreamingAssistantEvent(
                  buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
                );
              }
            }
          }
          if (obj.type === "tool-output-available") {
            const toolCallId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
            const existing = toolCallId ? streamingRef.current.toolCalls[toolCallId] : null;
            if (existing) {
              existing.output = obj.output;
              existing.state = "output-available";
              const assistantId = getActiveAssistantMessageId();
              if (assistantId) {
                setStreamingAssistantEvent(
                  buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
                );
              }
            }
          }
          if (obj.type === "tool-output-error") {
            const toolCallId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
            const existing = toolCallId ? streamingRef.current.toolCalls[toolCallId] : null;
            if (existing) {
              existing.errorText =
                typeof obj.errorText === "string" ? obj.errorText : "Tool error";
              existing.state = "output-error";
              const assistantId = getActiveAssistantMessageId();
              if (assistantId) {
                setStreamingAssistantEvent(
                  buildStreamingAssistantEvent(assistantId, streamingRef.current.contextId)
                );
              }
            }
          }
          if (obj.type === "error" && typeof obj.errorText === "string") {
            setSendStatus("error");
            setSendError(String(obj.errorText));
          }

          // Finish chunk clears resumable state
          if (
            (obj.type === "finish" || obj.type === "finish-step") &&
            enableResumableStreams &&
            typeof window !== "undefined"
          ) {
            try {
              window.localStorage.removeItem(runIdKeyFor("active"));
              window.localStorage.removeItem(chunkIndexKeyFor("active"));
              window.localStorage.removeItem(assistantMessageIdKeyFor("active"));
              if (currentCtx) {
                window.localStorage.removeItem(runIdKeyFor(currentCtx));
                window.localStorage.removeItem(chunkIndexKeyFor(currentCtx));
                window.localStorage.removeItem(assistantMessageIdKeyFor(currentCtx));
              }
            } catch {
              // ignore
            }
          }
          if (obj.type === "finish" || obj.type === "finish-step") {
            // The stream is logically complete; stop reading so UI can exit "submitting/streaming".
            shouldStop = true;
          }

          if (obj.type === "data-context-id") {
            const cid = obj?.data?.contextId;
            if (typeof cid === "string" && cid.length > 0) {
              setActiveContextForEphemeral(cid);
              handleContextUpdate(cid);

              if (enableResumableStreams && typeof window !== "undefined") {
                try {
                  const activeRunId = window.localStorage.getItem(runIdKeyFor("active"));
                  if (activeRunId) window.localStorage.setItem(runIdKeyFor(cid), activeRunId);
                  const activeChunk = window.localStorage.getItem(chunkIndexKeyFor("active"));
                  if (activeChunk) window.localStorage.setItem(chunkIndexKeyFor(cid), activeChunk);
                  const activeAssistantId = window.localStorage.getItem(
                    assistantMessageIdKeyFor("active")
                  );
                  if (activeAssistantId)
                    window.localStorage.setItem(assistantMessageIdKeyFor(cid), activeAssistantId);
                } catch {
                  // ignore
                }
              }

              currentCtx = cid;
            }
          }
          if (obj.type === "data-context-substate") {
            const key = obj?.data?.key;
            setTurnSubstateKey(typeof key === "string" ? key : null);
          }
        } catch {
          // ignore
        }
      };

      const splitLines = (rawEvent: string) => rawEvent.split(/\r?\n/);

      const findSeparator = (s: string): { idx: number; len: number } | null => {
        const a = s.indexOf("\n\n");
        const b = s.indexOf("\r\n\r\n");
        if (a === -1 && b === -1) return null;
        if (a === -1) return { idx: b, len: 4 };
        if (b === -1) return { idx: a, len: 2 };
        return a < b ? { idx: a, len: 2 } : { idx: b, len: 4 };
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const sep = findSeparator(buffer);
          if (!sep) break;
          const event = buffer.slice(0, sep.idx);
          buffer = buffer.slice(sep.idx + sep.len);
          for (const line of splitLines(event)) processLine(line);
          if (shouldStop) break;
        }
        if (shouldStop) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
      }

      // If the underlying stream ends without a final separator, still process
      // any buffered lines so we can observe `finish` or `[DONE]`.
      if (!shouldStop && buffer.length > 0) {
        for (const line of splitLines(buffer)) processLine(line);
      }
    },
    [
      assistantMessageIdKeyFor,
      chunkIndexKeyFor,
      contextId,
      enableResumableStreams,
      handleContextUpdate,
      readChunkIndex,
      runIdKeyFor,
      writeChunkIndex,
    ]
  );

  const append = useCallback(
    async ({ parts, webSearch = false, reasoningLevel = "low" }: AppendArgs) => {
      if (!Array.isArray(parts) || parts.length === 0) return;

      // Abort previous if any
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // ignore
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setSendError(null);
      setSendStatus("submitting");

      const messageId = id(); // UUID (Instant)

      // Optimistic event for UI timeline (context may be null until backend emits it)
      const optimisticEvent: EphemeralEvent = {
        __contextId: contextId,
        id: messageId,
        type: USER_MESSAGE_TYPE,
        channel: "web",
        createdAt: new Date().toISOString(),
        content: { parts },
      };
      setOptimisticEvents((prev) => [...prev, optimisticEvent]);

      // Backend expects UIMessage[] (it will derive ContextEvent from last message.parts)
      const uiMessage = {
        id: messageId,
        role: "user",
        parts,
        metadata: { eventId: messageId, clientCreatedAt: Date.now() },
      };

      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [uiMessage],
            webSearch,
            reasoningLevel,
            contextId: contextId || undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          setSendStatus("error");
          setSendError(txt || `HTTP ${res.status}`);
          return;
        }

        if (enableResumableStreams && typeof window !== "undefined") {
          try {
            const runId = res.headers.get("x-workflow-run-id");
            if (runId) {
              window.localStorage.setItem(runIdKeyFor("active"), runId);
              if (contextId) window.localStorage.setItem(runIdKeyFor(contextId), runId);
              window.localStorage.setItem(chunkIndexKeyFor("active"), "-1");
              if (contextId) window.localStorage.setItem(chunkIndexKeyFor(contextId), "-1");
            }
          } catch {
            // ignore
          }
        }

        await readSseAndCaptureContext(res, { startIndex: 0 });
        setSendStatus("idle");
      } catch (e: any) {
        if (e?.name === "AbortError") {
          setSendStatus("idle");
          return;
        }
        setSendStatus("error");
        setSendError(String(e?.message || e || "Request failed"));
      } finally {
        abortRef.current = null;
      }
    },
    [
      apiUrl,
      chunkIndexKeyFor,
      contextId,
      enableResumableStreams,
      readSseAndCaptureContext,
      runIdKeyFor,
    ]
  );

  const resumeStreamIfNeeded = useCallback(async () => {
    if (!enableResumableStreams) return;
    if (typeof window === "undefined") return;
    if (abortRef.current) return;

    const ctx = contextId;
    const runId =
      window.localStorage.getItem(runIdKeyFor(ctx)) ??
      window.localStorage.getItem(runIdKeyFor("active"));
    if (!runId) return;

    const lastIdx = readChunkIndex(ctx);
    const startIndex = lastIdx + 1;
    const params = new URLSearchParams();
    params.set("runId", runId);
    if (Number.isFinite(startIndex) && startIndex > 0) {
      params.set("startIndex", String(startIndex));
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${apiUrl}?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok) return;
      await readSseAndCaptureContext(res, { startIndex });
    } catch {
      // ignore
    } finally {
      abortRef.current = null;
    }
  }, [
    apiUrl,
    contextId,
    enableResumableStreams,
    readChunkIndex,
    readSseAndCaptureContext,
    runIdKeyFor,
  ]);

  useEffect(() => {
    if (!enableResumableStreams) return;
    if (contextStatus !== "streaming") return;
    void resumeStreamIfNeeded();
  }, [contextStatus, enableResumableStreams, resumeStreamIfNeeded]);

  return {
    apiUrl,
    contextId,
    contextStatus,
    turnSubstateKey,
    events: mergedEvents,
    sendStatus,
    sendError,
    stop,
    append,
  };
}

