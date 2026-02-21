"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppendArgs,
  ContextEventForUI,
  ThreadValue,
} from "@/components/ekairos/thread/context";
import {
  ASSISTANT_MESSAGE_TYPE,
  INPUT_TEXT_ITEM_TYPE,
} from "@/components/ekairos/thread/context";

type LiveRunResponse = {
  ok: boolean;
  data?: {
    appId?: string;
    contextId: string;
    providerThreadId: string | null;
    triggerEvent: ContextEventForUI;
    assistantEvent: ContextEventForUI;
    llm?: Record<string, unknown>;
    chunks?: Array<Record<string, unknown>>;
  };
  error?: string;
};

type InitTenantResponse = {
  ok: boolean;
  data?: {
    appId: string;
    adminToken: string;
    visitorId: string;
  };
  error?: string;
};

const VISITOR_STORAGE_KEY = "ekairos.registry.demo.visitorId";
const APP_STORAGE_KEY = "ekairos.registry.demo.appId";
const APP_ADMIN_TOKEN_STORAGE_KEY = "ekairos.registry.demo.adminToken";

function makeId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}:${id}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function makeUuid(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  return "00000000-0000-4000-8000-000000000000";
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function sanitizeEvent(
  input: unknown,
  fallbackType: string,
  fallbackText = "",
): ContextEventForUI {
  const row = asRecord(input);
  const content = asRecord(row.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const hasTextFallback = fallbackText.trim().length > 0;

  return {
    id: asString(row.id) || makeId("event"),
    type: asString(row.type) || fallbackType,
    channel: asString(row.channel) || "web",
    createdAt: asString(row.createdAt) || nowIso(),
    status: asString(row.status) || "stored",
    content: {
      parts:
        parts.length > 0
          ? parts
          : hasTextFallback
            ? [{ type: "text", text: fallbackText }]
            : [],
    },
  };
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

export function useLiveCodexThread(): ThreadValue & {
  reset: () => void;
  title: string;
  profile: {
    reactor: "codex";
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
  const [events, setEvents] = useState<ContextEventForUI[]>([]);
  const [contextStatus, setContextStatus] = useState<"open" | "streaming" | "closed">("open");
  const [sendStatus, setSendStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string>("");
  const [providerThreadId, setProviderThreadId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>("openai/gpt-5.2-codex");
  const [appId, setAppId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const runCounterRef = useRef(0);

  useEffect(() => {
    setContextId((current) => (current ? current : makeUuid()));
  }, []);

  const ensureTenant = useCallback(async (): Promise<{ appId: string; adminToken: string }> => {
    if (typeof window === "undefined") {
      throw new Error("Tenant initialization requires browser context.");
    }

    let visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY)?.trim() || "";
    if (!visitorId) {
      visitorId = `visitor-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
    }

    const knownAppId =
      appId ||
      window.localStorage.getItem(APP_STORAGE_KEY)?.trim() ||
      undefined;

    const response = await fetch("/api/demo/tenant/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitorId,
        appId: knownAppId,
      }),
    });
    const payload = (await response.json()) as InitTenantResponse;
    if (!response.ok || !payload.ok || !payload.data?.appId || !payload.data?.adminToken) {
      throw new Error(payload.error || "Failed to initialize registry tenant.");
    }

    window.localStorage.setItem(APP_STORAGE_KEY, payload.data.appId);
    window.localStorage.setItem(APP_ADMIN_TOKEN_STORAGE_KEY, payload.data.adminToken);
    setAppId(payload.data.appId);
    setAdminToken(payload.data.adminToken);
    return { appId: payload.data.appId, adminToken: payload.data.adminToken };
  }, [appId]);

  const stop = useCallback(() => {
    runCounterRef.current += 1;
    setContextStatus("open");
    setSendStatus("idle");
    setTurnSubstateKey(null);
  }, []);

  const reset = useCallback(() => {
    stop();
    setEvents([]);
    setSendError(null);
    setProviderThreadId(null);
    setContextId(makeUuid());
    setModel("openai/gpt-5.2-codex");
  }, [stop]);

  const append = useCallback(async (args: AppendArgs) => {
    if (sendStatus === "submitting") return;
    const promptText = extractPromptText(args.parts);
    if (!promptText) return;

    const runToken = runCounterRef.current + 1;
    runCounterRef.current = runToken;

    setSendError(null);
    setSendStatus("submitting");
    setContextStatus("streaming");
    setTurnSubstateKey("code.runtime.calling");

    const optimisticUserEvent: ContextEventForUI = {
      id: makeId("user"),
      type: INPUT_TEXT_ITEM_TYPE,
      channel: "web",
      createdAt: nowIso(),
      status: "stored",
      content: { parts: [{ type: "text", text: promptText }] },
    };
    setEvents((prev) => [...prev, optimisticUserEvent]);

    try {
      const tenant = await ensureTenant();
      const response = await fetch("/api/codex-demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: tenant.appId,
          adminToken: tenant.adminToken,
          prompt: promptText,
          contextId,
          providerThreadId: providerThreadId ?? undefined,
          model: model ?? undefined,
          approvalPolicy: "never",
        }),
      });
      const payload = (await response.json()) as LiveRunResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Codex demo request failed.");
      }
      if (runCounterRef.current !== runToken) return;

      const serverUserEvent = sanitizeEvent(
        payload.data.triggerEvent,
        INPUT_TEXT_ITEM_TYPE,
        promptText,
      );
      const assistantEvent = sanitizeEvent(
        payload.data.assistantEvent,
        ASSISTANT_MESSAGE_TYPE,
      );

      setContextId(asString(payload.data.contextId) || contextId);
      setProviderThreadId(
        payload.data.providerThreadId && payload.data.providerThreadId.length > 0
          ? payload.data.providerThreadId
          : null,
      );
      const llmModel = asString(asRecord(payload.data.llm).model);
      if (llmModel) setModel(llmModel);

      setEvents((prev) => {
        const next = [...prev];
        const optimisticIndex = next.findIndex((entry) => entry.id === optimisticUserEvent.id);
        if (optimisticIndex >= 0) {
          next[optimisticIndex] = serverUserEvent;
        } else {
          next.push(serverUserEvent);
        }
        next.push(assistantEvent);
        return next;
      });

      setContextStatus("open");
      setSendStatus("idle");
      setTurnSubstateKey(null);
    } catch (error) {
      if (runCounterRef.current !== runToken) return;
      setContextStatus("open");
      setSendStatus("error");
      setTurnSubstateKey(null);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [contextId, ensureTenant, model, providerThreadId, sendStatus]);

  return useMemo(
    () => ({
      apiUrl: "/api/codex-demo/run",
      contextId,
      contextStatus,
      turnSubstateKey,
      events,
      sendStatus,
      sendError,
      stop,
      append,
      reset,
      title: "Codex live reactor",
      profile: {
        reactor: "codex" as const,
        runtimeMode: "local",
        provider: "codex-app-server",
        model,
        appServerUrl: null,
        approvalPolicy: "never",
        threadId: providerThreadId || "-",
        executionId: "-",
        fixtureId: appId || adminToken || "live",
      },
    }),
    [adminToken, appId, append, contextId, contextStatus, events, model, providerThreadId, reset, sendError, sendStatus, stop, turnSubstateKey],
  );
}
