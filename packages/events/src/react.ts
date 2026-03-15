"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ContextStatus } from "./context.contract.js"

export type ContextSnapshot<Context = unknown, Item = Record<string, unknown>> = {
  context: {
    id: string
    key: string | null
    name?: string | null
    status: ContextStatus
    content: Context
    createdAt: string | null
    updatedAt: string | null
  } | null
  items: Item[]
}

export type ContextStreamChunk =
  | {
      type: `data-context.${string}`
      data?: { contextId?: string }
    }
  | {
      type: string
      [key: string]: unknown
    }

export type UseContextOptions<Context = unknown, Item = Record<string, unknown>> = {
  contextKey: string
  orgId?: string
  endpoint?: string
  refreshMs?: number
  ensure?: boolean
  enabled?: boolean
  initialData?: ContextSnapshot<Context, Item> | null
  fetchImpl?: typeof fetch
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? "unknown_error")
}

function buildContextUrl<Context = unknown, Item = Record<string, unknown>>(
  options: UseContextOptions<Context, Item>,
): string {
  const base = String(options.endpoint || "/api/context").replace(/\/+$/, "")
  const key = encodeURIComponent(options.contextKey)
  const params = new URLSearchParams()
  if (options.orgId) params.set("orgId", options.orgId)
  if (options.ensure) params.set("ensure", "1")
  const query = params.toString()
  return query.length > 0 ? `${base}/${key}?${query}` : `${base}/${key}`
}

export function useContext<Context = unknown, Item = Record<string, unknown>>(
  options: UseContextOptions<Context, Item>,
) {
  const [data, setData] = useState<ContextSnapshot<Context, Item> | null>(
    options.initialData ?? null,
  )
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [contextId, setContextId] = useState<string | null>(null)

  const enabled = options.enabled ?? true

  const url = useMemo(() => {
    if (!enabled || !options.contextKey) return ""
    return buildContextUrl(options)
  }, [enabled, options.endpoint, options.orgId, options.contextKey, options.ensure])

  const refresh = useCallback(async () => {
    if (!enabled || !options.contextKey) return
    setIsLoading(true)
    setError(null)
    const fetchImpl = options.fetchImpl ?? fetch

    try {
      const response = await fetchImpl(url, { cache: "no-store" })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(body || `context_fetch_failed:${response.status}`)
      }

      const snapshot = (await response.json()) as ContextSnapshot<Context, Item>
      setData(snapshot)
      setContextId(snapshot.context?.id ?? null)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [enabled, options.fetchImpl, options.contextKey, url])

  const applyChunk = useCallback((chunk: ContextStreamChunk) => {
    if (!chunk || typeof chunk !== "object") return
    if (typeof chunk.type === "string" && chunk.type.startsWith("data-context.")) {
      const payload =
        "data" in chunk && chunk.data && typeof chunk.data === "object"
          ? (chunk.data as { contextId?: unknown })
          : undefined
      const candidate =
        typeof payload?.contextId === "string"
          ? payload.contextId
          : null
      if (candidate) setContextId(candidate)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!enabled || !options.refreshMs || options.refreshMs <= 0) return
    const intervalId = setInterval(() => {
      void refresh()
    }, options.refreshMs)
    return () => clearInterval(intervalId)
  }, [enabled, options.refreshMs, refresh])

  return {
    data,
    isLoading,
    error,
    refresh,
    setData,
    contextId,
    applyChunk,
    url,
  }
}
