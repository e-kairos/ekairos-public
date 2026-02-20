"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ThreadContextStatus,
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
      type: `data-context.${string}`;
      data?: { contextId?: string };
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
    if (typeof chunk.type === "string" && chunk.type.startsWith("data-context.")) {
      const payload =
        "data" in chunk && chunk.data && typeof chunk.data === "object"
          ? (chunk.data as { contextId?: unknown })
          : undefined;
      const candidate =
        typeof payload?.contextId === "string"
          ? payload.contextId
          : null;
      if (candidate) setContextId(candidate);
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
    applyChunk,
    url,
  };
}
