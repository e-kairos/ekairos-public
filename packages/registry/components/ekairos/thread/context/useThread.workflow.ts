"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@workflow/ai";

import {
  ASSISTANT_MESSAGE_TYPE,
  INPUT_TEXT_ITEM_TYPE,
  type AppendArgs,
  type ContextEventForUI,
  type ContextStatus,
  type SendStatus,
  type ThreadValue,
  type UseThreadContextHook,
  type UseThreadEventsHook,
  type UseThreadOptions,
} from "./types";

type ResumableStorageKind = "run-id";
type EphemeralEvent = ContextEventForUI & { __contextId: string | null };

type UIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: any[];
  metadata?: any;
};

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
  // Fallback UUID-ish (last resort)
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .slice(1);
  return `${s4()}${s4()}-${s4()}-4${s4().slice(1)}-${(
    (8 + Math.random() * 4) |
    0
  ).toString(16)}${s4().slice(1)}-${s4()}${s4()}${s4()}`;
}

function makeStorageKey(apiUrl: string) {
  const prefix = `ekairos-thread:context:${apiUrl}`;
  return function keyFor(kind: ResumableStorageKind, contextId: string | null) {
    return `${prefix}:${kind}:${contextId || "active"}`;
  };
}

function mergeEvents(params: {
  persisted: ContextEventForUI[];
  optimistic: EphemeralEvent[];
  streamingAssistant: EphemeralEvent | null;
  currentContextId: string | null;
  allowStreamingOverlay: boolean;
}): ContextEventForUI[] {
  const persisted = params.persisted;
  const byId = new Map<string, ContextEventForUI>();
  for (const ev of persisted) byId.set(String(ev?.id), ev);

  const merged: ContextEventForUI[] = [...persisted];

  // Optimistic events (active context only)
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

  // Streaming assistant overlay (active context only)
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
      // IMPORTANT:
      // - The Instant store persists events with status "stored" (not "streaming").
      // - Streaming UI should be driven by the *active stream* (SSE / useChat), not by persisted status.
      // - We only overlay while the active stream is for the selected context; and never if the event is completed.
      const shouldOverlay =
        params.allowStreamingOverlay && status !== "completed";
      if (shouldOverlay) {
        const mergedParts: any[] = Array.isArray(persistedEvent.content?.parts)
          ? [...persistedEvent.content.parts]
          : [];

        const streamingParts: any[] = Array.isArray(streaming.content?.parts)
          ? streaming.content.parts
          : [];

        // Prefer longer streaming text over persisted text
        const streamingText = streamingParts.find(
          (p: any) => p?.type === "text"
        );
        if (streamingText && typeof streamingText.text === "string") {
          const persistedTextIdx = mergedParts.findIndex(
            (p: any) => p?.type === "text"
          );
          if (persistedTextIdx === -1)
            mergedParts.push({ type: "text", text: streamingText.text });
          else {
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

const useDefaultContext: UseThreadContextHook = (db, { contextId }) => {
  const contextRes = db.useQuery(
    (contextId
      ? {
          thread_contexts: {
            $: { where: { id: contextId as any }, limit: 1 },
          },
        }
      : null) as any
  );

  const ctx = (contextRes as any)?.data?.thread_contexts?.[0] ?? null;
  const contextStatus = ((ctx?.status as ContextStatus) ||
    "open") as ContextStatus;

  return { context: ctx, contextStatus };
};

const useDefaultEvents: UseThreadEventsHook = (db, { contextId }) => {
  const eventsRes = db.useQuery(
    (contextId
      ? {
          thread_items: {
            $: {
              where: { "context.id": contextId as any },
              order: { createdAt: "asc" },
            },
          },
        }
      : null) as any
  );

  const raw = (eventsRes as any)?.data?.thread_items ?? [];
  return { events: Array.isArray(raw) ? (raw as ContextEventForUI[]) : [] };
};

function eventToMessage(ev: ContextEventForUI): UIMessage {
  const role = ev.type === INPUT_TEXT_ITEM_TYPE ? "user" : "assistant";
  return {
    id: String(ev.id),
    role,
    parts: Array.isArray(ev.content?.parts) ? ev.content.parts : [],
    metadata: {
      channel: ev.channel,
      type: ev.type,
      createdAt: ev.createdAt,
      eventId: ev.id,
      status: ev.status,
      emails: ev.emails,
      whatsappMessages: ev.whatsappMessages,
    },
  };
}

function messageToEphemeralEvent(
  msg: UIMessage,
  ctx: string | null
): EphemeralEvent {
  return {
    __contextId: ctx,
    id: String(msg.id),
    type: msg.role === "user" ? INPUT_TEXT_ITEM_TYPE : ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: new Date().toISOString(),
    content: { parts: Array.isArray(msg.parts) ? msg.parts : [] },
  };
}

function partsToSendPayload(parts: any[]): { text: string; files: any[] } {
  const p = Array.isArray(parts) ? parts : [];
  const text = p
    .filter((x) => x?.type === "text" && typeof x?.text === "string")
    .map((x) => String(x.text))
    .join("\n\n")
    .trim();

  const files = p.filter(
    (x) => x?.type === "file" && typeof x?.url === "string"
  );
  return { text, files };
}

export function useThread(db: any, opts: UseThreadOptions): ThreadValue {
  const {
    apiUrl,
    initialContextId,
    onContextUpdate,
    enableResumableStreams = false,
    context: useContextImpl = useDefaultContext,
    events: useEventsImpl = useDefaultEvents,
  } = opts;

  const [contextId, setContextId] = useState<string | null>(
    initialContextId || null
  );
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);

  const isDebugEnabled = useCallback(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("ekairos:debug") === "1";
    } catch {
      return false;
    }
  }, []);

  const selectedContextIdRef = useRef<string | null>(initialContextId || null);
  const streamContextIdRef = useRef<string | null>(initialContextId || null);
  const lastSendExtrasRef = useRef<
    Pick<AppendArgs, "webSearch" | "reasoningLevel">
  >({
    webSearch: false,
    reasoningLevel: "low",
  });

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
    [onContextUpdate]
  );

  const { contextStatus } = useContextImpl(db, { contextId });
  const { events: persistedEventsUnsorted } = useEventsImpl(db, { contextId });

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

    return events.slice().sort((a: any, b: any) => {
      const aMs = parseTs(a?.createdAt);
      const bMs = parseTs(b?.createdAt);
      if (aMs !== bMs) return aMs - bMs;
      return String(a?.id).localeCompare(String(b?.id));
    });
  }, [persistedEventsUnsorted]);

  const persistedMessages = useMemo(
    () => persistedEvents.map(eventToMessage),
    [persistedEvents]
  );

  const keyFor = useMemo(() => makeStorageKey(apiUrl), [apiUrl]);
  const runIdKeyFor = useCallback(
    (ctx: string | null) => keyFor("run-id", ctx),
    [keyFor]
  );

  const storedRunId = useMemo(() => {
    if (!enableResumableStreams) return undefined;
    if (typeof window === "undefined") return undefined;
    try {
      const ctx = selectedContextIdRef.current;
      return (
        window.localStorage.getItem(runIdKeyFor(ctx)) ??
        window.localStorage.getItem(runIdKeyFor("active")) ??
        undefined
      );
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableResumableStreams, runIdKeyFor]);

  const transport = useMemo(() => {
    const t: any = new WorkflowChatTransport({
      api: apiUrl,
      maxConsecutiveErrors: 3,
      prepareSendMessagesRequest: async (config: any) => {
        // IMPORTANT:
        // `@workflow/ai`'s WorkflowChatTransport sends `{ messages }` by default.
        // Our backend endpoints require `contextId` (and extras) to continue an existing context.
        // If we omit it, the server will create/route to a NEW context and the UI (which is pinned
        // to the selectedContextId) will "look like nothing happened".
        const ctx = selectedContextIdRef.current;
        const extras = lastSendExtrasRef.current;

        const body = {
          messages: (config as any)?.messages ?? [],
          webSearch: Boolean(extras?.webSearch),
          reasoningLevel: (extras?.reasoningLevel ?? "low") as any,
          contextId: ctx || undefined,
        };

        if (isDebugEnabled()) {
          // eslint-disable-next-line no-console
          console.log("[ekairos:chat] prepareSendMessagesRequest", {
            api: config?.api,
            contextId: ctx || null,
            bodyKeys: Object.keys(body),
            messagesLen: Array.isArray(body.messages)
              ? body.messages.length
              : 0,
            hasHeaders: Boolean(config?.headers),
          });
        }

        // Do NOT change cookies/credentials behavior (leave fetch default).
        // Provide the correct body expected by our Next.js API routes.
        return { ...(config as any), body };
      },
      onChatSendMessage: (response) => {
        if (isDebugEnabled()) {
          try {
            // eslint-disable-next-line no-console
            console.log("[ekairos:chat] sendMessage response", {
              apiUrl,
              status: response.status,
              runId: response.headers.get("x-workflow-run-id"),
            });
          } catch {
            // ignore
          }
        }
        if (!enableResumableStreams) return;
        if (typeof window === "undefined") return;
        try {
          const runId = response.headers.get("x-workflow-run-id");
          if (!runId) return;
          const ctx =
            streamContextIdRef.current ?? selectedContextIdRef.current;
          window.localStorage.setItem(runIdKeyFor("active"), runId);
          if (ctx) window.localStorage.setItem(runIdKeyFor(ctx), runId);
        } catch {
          // ignore
        }
      },
      onChatEnd: () => {
        if (isDebugEnabled()) {
          // eslint-disable-next-line no-console
          console.debug("[ekairos:chat] onChatEnd", {
            apiUrl,
            contextId: selectedContextIdRef.current,
            streamContextId: streamContextIdRef.current,
          });
        }
        if (!enableResumableStreams) return;
        if (typeof window === "undefined") return;
        try {
          const ctx =
            streamContextIdRef.current ?? selectedContextIdRef.current;
          window.localStorage.removeItem(runIdKeyFor("active"));
          if (ctx) window.localStorage.removeItem(runIdKeyFor(ctx));
        } catch {
          // ignore
        }
      },
      prepareReconnectToStreamRequest: async (config) => {
        if (!enableResumableStreams) return { ...config };
        if (typeof window === "undefined") return { ...config };
        try {
          const ctx =
            streamContextIdRef.current ?? selectedContextIdRef.current;
          const runId =
            window.localStorage.getItem(runIdKeyFor(ctx)) ??
            window.localStorage.getItem(runIdKeyFor("active"));
          if (!runId) return { ...config };

          // Namespaced streams: always use `namespace = context:<contextId>`.
          // We pass the `contextId` as a query param so the server can select the namespace
          // without changing the route shape.
          const query = new URLSearchParams();
          if (ctx) query.set("contextId", String(ctx));
          const q = query.toString();
          return {
            ...config,
            api: q
              ? `${apiUrl}/${encodeURIComponent(runId)}/stream?${q}`
              : `${apiUrl}/${encodeURIComponent(runId)}/stream`,
          };
        } catch {
          return { ...config };
        }
      },
    });

    return t as any;
  }, [apiUrl, enableResumableStreams, isDebugEnabled, runIdKeyFor]);

  const {
    messages,
    sendMessage,
    status: chatStatus,
    error: chatError,
    stop: stopChat,
    setMessages,
    resumeStream,
  } = useChat({
    resume: Boolean(storedRunId),
    // CRITICAL: persisted `thread_items` ids are Instant entity ids, which must be UUIDs.
    // Ensure client-side message ids are UUIDs so `createUserItemFromUIMessages(messages)` produces valid ids.
    generateId: () => randomUuidV4(),
    transport: transport as any,
    onData: (data: any) => {
      if (!data || typeof data !== "object") return;
      if (isDebugEnabled()) {
        const t = (data as any)?.type;
        if (
          t === "start" ||
          t === "finish" ||
          t === "data-context-id" ||
          t === "tool-output-available" ||
          t === "tool-output-error"
        ) {
          // eslint-disable-next-line no-console
          console.debug("[ekairos:chat] onData", { type: t, data });
        }
      }
      if (data.type === "data-context-id") {
        const cid = (data as any)?.data?.contextId;
        if (typeof cid !== "string" || cid.length === 0) return;
        streamContextIdRef.current = cid;

        // No hijack: only update selected context if user is not browsing another thread.
        const selected = selectedContextIdRef.current;
        if (selected == null || selected === cid) {
          handleContextUpdate(cid);
        }
      }
      if (data.type === "data-context-substate") {
        const key = (data as any)?.data?.key;
        setTurnSubstateKey(typeof key === "string" ? key : null);
      }
    },
    experimental_prepareRequestBody: ({ messages }: { messages: any[] }) => {
      const ctx = selectedContextIdRef.current;
      const extras = lastSendExtrasRef.current;
      return {
        messages,
        webSearch: extras.webSearch,
        reasoningLevel: extras.reasoningLevel,
        contextId: ctx || undefined,
      };
    },
  } as any);

  const streamContextId = streamContextIdRef.current;
  const isStreamContextSelected =
    String(streamContextId ?? contextId ?? "") === String(contextId ?? "");

  const persistedEventIds = useMemo(
    () => new Set(persistedEvents.map((e: any) => String(e?.id))),
    [persistedEvents]
  );

  const hasOptimisticUser = useMemo(() => {
    if (!isStreamContextSelected) return false;
    const list = Array.isArray(messages) ? messages : [];
    return list.some(
      (m: any) =>
        m?.role === "user" &&
        typeof m?.id === "string" &&
        !persistedEventIds.has(String(m.id))
    );
  }, [isStreamContextSelected, messages, persistedEventIds]);

  const hasOptimisticAssistant = useMemo(() => {
    if (!isStreamContextSelected) return false;
    const list = Array.isArray(messages) ? messages : [];
    return list.some(
      (m: any) =>
        m?.role === "assistant" &&
        typeof m?.id === "string" &&
        !persistedEventIds.has(String(m.id))
    );
  }, [isStreamContextSelected, messages, persistedEventIds]);

  const hasPendingLocalTurn = hasOptimisticUser || hasOptimisticAssistant;

  // Refs to observe whether `sendMessage` actually enqueued anything.
  // This helps diagnose the "Enter -> nothing happens" case where `sendMessage`
  // resolves but no request/state transition occurs.
  const chatStatusRef = useRef(chatStatus);
  const messagesRef = useRef(messages);
  useEffect(() => {
    chatStatusRef.current = chatStatus;
  }, [chatStatus]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Auto-resume if the selected context is marked as streaming and we have a runId stored.
  useEffect(() => {
    if (!enableResumableStreams) return;
    if (typeof window === "undefined") return;
    if (contextStatus !== "streaming") return;
    const ctx = selectedContextIdRef.current;
    const runId =
      window.localStorage.getItem(runIdKeyFor(ctx)) ??
      window.localStorage.getItem(runIdKeyFor("active"));
    if (!runId) return;
    if (isDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.debug("[ekairos:chat] auto-resumeStream", {
        apiUrl,
        contextStatus,
        chatStatus,
        contextId: ctx,
        runId,
      });
    }
    // Transport will reconnect to /{runId}/stream and compute startIndex internally.
    void resumeStream?.();
  }, [contextStatus, enableResumableStreams, resumeStream, runIdKeyFor]);

  const isStreamingForSelected =
    chatStatus !== "ready" &&
    (streamContextIdRef.current ?? selectedContextIdRef.current) ===
      selectedContextIdRef.current;

  // IMPORTANT:
  // `contextStatus` is persisted in InstantDB and can lag behind the actual stream lifecycle.
  // If the client stream is already `ready`, treat the context as open even if the DB still says "streaming",
  // otherwise the UI can silently block submits after a completed turn.
  const effectiveContextStatus: ContextStatus = useMemo(() => {
    if (contextStatus === "streaming") {
      if (chatStatus === "ready" && !hasPendingLocalTurn) {
        return "open";
      }
      return "streaming";
    }
    if (hasPendingLocalTurn) return "streaming";
    return contextStatus;
  }, [chatStatus, contextStatus, hasPendingLocalTurn]);

  // Safety: if the durable store already shows the latest assistant message as completed,
  // but the client stream didn't deliver a finish chunk (stuck "submitting"),
  // force-stop the client stream so the UI can exit "Procesando".
  useEffect(() => {
    if (!isStreamingForSelected) return;
    if (!contextId) return;

    // IMPORTANT:
    // When a NEW user message is being sent, `persistedEvents` still ends with the previous
    // assistant message (completed). In that moment, we might briefly be in a non-ready
    // chatStatus (submitted/streaming) for the *new* turn, and this safety would incorrectly
    // abort the new request immediately.
    //
    // Guard: if there is any pending local turn (user/assistant message not yet
    // persisted), do NOT stop the chat.
    if (hasPendingLocalTurn) {
      return;
    }

    const last = persistedEvents[persistedEvents.length - 1] as any;
    const isAssistant = last?.type === ASSISTANT_MESSAGE_TYPE;
    const isCompleted = last?.status === "completed";
    if (!isAssistant || !isCompleted) return;

    // IMPORTANT:
    // `stopChat` returns a Promise. A sync try/catch does NOT catch async rejections.
    // Swallow AbortError to avoid noisy console errors like "BodyStreamBuffer was aborted".
    try {
      void stopChat?.().catch(() => {
        // ignore
      });
    } catch {
      // ignore
    }

    if (!enableResumableStreams) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(runIdKeyFor("active"));
      window.localStorage.removeItem(runIdKeyFor(contextId));
    } catch {
      // ignore
    }
  }, [
    contextId,
    enableResumableStreams,
    hasPendingLocalTurn,
    isStreamingForSelected,
    persistedEvents,
    runIdKeyFor,
    stopChat,
  ]);

  const sendStatus: SendStatus =
    chatStatus === "error"
      ? "error"
      : hasPendingLocalTurn
        ? "submitting"
        : "idle";

  const sendError =
    chatStatus === "error"
      ? String((chatError as any)?.message || chatError || "Request failed")
      : null;

  const stop = useCallback(() => {
    try {
      void stopChat?.().catch(() => {
        // ignore
      });
    } catch {
      // ignore
    }
  }, [stopChat]);

  const append = useCallback(
    async ({ parts, webSearch, reasoningLevel }: AppendArgs) => {
      lastSendExtrasRef.current = {
        webSearch: Boolean(webSearch),
        reasoningLevel: (reasoningLevel ?? "low") as any,
      };

      // Stream is associated to the currently selected context (may be null for new chats).
      streamContextIdRef.current = selectedContextIdRef.current ?? null;

      const { text, files } = partsToSendPayload(parts);
      if (!text && (!files || files.length === 0)) return;

      if (isDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.debug("[ekairos:chat] append -> sendMessage", {
          apiUrl,
          selectedContextId: selectedContextIdRef.current,
          streamContextId: streamContextIdRef.current,
          chatStatus,
          textPreview: text.slice(0, 120),
          hasFiles: Boolean(files?.length),
        });
      }

      const beforeLen = Array.isArray(messagesRef.current)
        ? messagesRef.current.length
        : 0;
      const before = Date.now();
      await sendMessage({
        text,
        files,
      } as any);

      if (isDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.debug("[ekairos:chat] sendMessage returned", {
          ms: Date.now() - before,
          chatStatusAfter: chatStatus,
        });
      }

      // Detect silent no-op (no local enqueue + status still ready).
      // If this happens, we throw so PromptBar won't clear the input.
      await new Promise((r) => setTimeout(r, 50));
      const afterLen = Array.isArray(messagesRef.current)
        ? messagesRef.current.length
        : 0;
      const statusAfter = chatStatusRef.current;

      if (afterLen === beforeLen && statusAfter === "ready") {
        if (isDebugEnabled()) {
          // eslint-disable-next-line no-console
          console.log("[ekairos:chat] sendMessage no-op detected", {
            apiUrl,
            beforeLen,
            afterLen,
            statusAfter,
            selectedContextId: selectedContextIdRef.current,
            streamContextId: streamContextIdRef.current,
            textPreview: text.slice(0, 120),
            hasFiles: Boolean(files?.length),
          });
        }
        throw new Error(
          "sendMessage no-op: no hubo cambio en `messages` ni `status` (probable issue de transport/request)."
        );
      }
    },
    [apiUrl, chatStatus, isDebugEnabled, sendMessage]
  );

  const optimisticEvents = useMemo(() => {
    if (!isStreamingForSelected) return [];
    const persistedIds = new Set(persistedEvents.map((e) => String(e.id)));
    return (
      (Array.isArray(messages) ? messages : [])
        .filter(
          (m: any) => m && typeof m === "object" && typeof m.id === "string"
        )
        // IMPORTANT:
        // Avoid rendering the assistant twice while streaming.
        // - `optimisticEvents` is for user messages that haven't been persisted yet.
        // - The streaming assistant is rendered via `streamingAssistantEvent` overlay.
        .filter((m: any) => m?.role === "user")
        .filter((m: any) => !persistedIds.has(String(m.id)))
        .map((m: any) =>
          messageToEphemeralEvent(m as UIMessage, streamContextIdRef.current)
        )
    );
  }, [isStreamingForSelected, messages, persistedEvents]);

  const streamingAssistantEvent = useMemo(() => {
    if (!isStreamingForSelected) return null;
    const list = Array.isArray(messages) ? (messages as any[]) : [];
    const lastAssistant = [...list]
      .reverse()
      .find((m) => m?.role === "assistant");
    if (!lastAssistant) return null;
    return messageToEphemeralEvent(
      lastAssistant as UIMessage,
      streamContextIdRef.current
    );
  }, [isStreamingForSelected, messages]);

  const mergedEvents = useMemo(
    () =>
      mergeEvents({
        persisted: persistedEvents,
        optimistic: optimisticEvents,
        streamingAssistant: streamingAssistantEvent,
        currentContextId: contextId,
        allowStreamingOverlay: isStreamingForSelected,
      }),
    [
      contextId,
      isStreamingForSelected,
      optimisticEvents,
      persistedEvents,
      streamingAssistantEvent,
    ]
  );

  return {
    apiUrl,
    contextId,
    contextStatus: effectiveContextStatus,
    turnSubstateKey,
    events: mergedEvents,
    sendStatus,
    sendError,
    stop,
    append,
  };
}
