"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ThreadContextStatus,
  ThreadContextSubstateKey,
  ThreadThreadStatus,
} from "./thread.contract.js";

export type ThreadSnapshot<Context = unknown, Item = Record<string, unknown>> = {
  thread: {
    id: string;
    key: string;
    status: ThreadThreadStatus;
    createdAt: string | null;
    updatedAt: string | null;
  };
  context: {
    id: string;
    status: ThreadContextStatus;
    content: Context;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  items: Item[];
};

export type ThreadStreamChunk =
  | {
      type: "data-context-id";
      data?: { contextId?: string };
      id?: string;
    }
  | {
      type: "data-context-substate";
      data?: { key?: ThreadContextSubstateKey | null };
      transient?: boolean;
    }
  | {
      type: "tool-output-available";
      toolCallId?: string;
      output?: unknown;
    }
  | {
      type: "tool-output-error";
      toolCallId?: string;
      errorText?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export type UseThreadOptions<Context = unknown, Item = Record<string, unknown>> = {
  threadKey: string;
  orgId?: string;
  endpoint?: string;
  refreshMs?: number;
  ensure?: boolean;
  enabled?: boolean;
  initialData?: ThreadSnapshot<Context, Item> | null;
  fetchImpl?: typeof fetch;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown_error");
}

function buildThreadUrl<Context = unknown, Item = Record<string, unknown>>(
  options: UseThreadOptions<Context, Item>,
): string {
  const base = String(options.endpoint || "/api/thread").replace(/\/+$/, "");
  const key = encodeURIComponent(options.threadKey);
  const params = new URLSearchParams();
  if (options.orgId) params.set("orgId", options.orgId);
  if (options.ensure) params.set("ensure", "1");
  const query = params.toString();
  return query.length > 0 ? `${base}/${key}?${query}` : `${base}/${key}`;
}

export function useThread<Context = unknown, Item = Record<string, unknown>>(
  options: UseThreadOptions<Context, Item>,
) {
  const [data, setData] = useState<ThreadSnapshot<Context, Item> | null>(
    options.initialData ?? null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [substateKey, setSubstateKey] = useState<string | null>(null);

  const enabled = options.enabled ?? true;

  const url = useMemo(() => {
    if (!enabled || !options.threadKey) return "";
    return buildThreadUrl(options);
  }, [enabled, options.endpoint, options.orgId, options.threadKey, options.ensure]);

  const refresh = useCallback(async () => {
    if (!enabled || !options.threadKey) return;
    setIsLoading(true);
    setError(null);
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `thread_fetch_failed:${response.status}`);
      }

      const snapshot = (await response.json()) as ThreadSnapshot<Context, Item>;
      setData(snapshot);
      setContextId(snapshot.context?.id ?? null);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, options.fetchImpl, options.threadKey, url]);

  const applyChunk = useCallback((chunk: ThreadStreamChunk) => {
    if (!chunk || typeof chunk !== "object") return;
    if (chunk.type === "data-context-id") {
      const payload =
        "data" in chunk && chunk.data && typeof chunk.data === "object"
          ? (chunk.data as { contextId?: unknown })
          : undefined;
      const candidate =
        typeof payload?.contextId === "string"
          ? payload.contextId
          : typeof chunk.id === "string"
            ? chunk.id
            : null;
      if (candidate) setContextId(candidate);
      return;
    }
    if (chunk.type === "data-context-substate") {
      const payload =
        "data" in chunk && chunk.data && typeof chunk.data === "object"
          ? (chunk.data as { key?: unknown })
          : undefined;
      const key = payload?.key;
      setSubstateKey(typeof key === "string" ? key : null);
      return;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !options.refreshMs || options.refreshMs <= 0) return;
    const intervalId = setInterval(() => {
      void refresh();
    }, options.refreshMs);
    return () => clearInterval(intervalId);
  }, [enabled, options.refreshMs, refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    setData,
    contextId,
    substateKey,
    applyChunk,
    url,
  };
}
