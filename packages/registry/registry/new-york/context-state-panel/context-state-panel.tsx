"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  useContext,
  type ContextSnapshot,
} from "@/registry/new-york/use-context/use-context"

type ContextStatePanelProps = {
  contextKey: string
  orgId?: string
  endpoint?: string
  emptyLabel?: string
  renderSummary?: (data: ContextSnapshot | null) => React.ReactNode
}

export function ContextStatePanel({
  contextKey,
  orgId,
  endpoint,
  emptyLabel = "No context loaded.",
  renderSummary,
}: ContextStatePanelProps) {
  const { data, isLoading, error, contextId, refresh } = useContext({
    contextKey,
    orgId,
    endpoint,
    ensure: true,
  })

  const itemCount = Array.isArray(data?.items) ? data.items.length : 0
  const summary =
    typeof renderSummary === "function"
      ? renderSummary(data ?? null)
      : null

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Ekairos Context
          </p>
          <p className="font-medium text-sm">{contextKey}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">contextId</span>
          <div className="truncate font-mono text-xs">{contextId ?? "-"}</div>
        </div>
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">status</span>
          <div className="font-medium">{data?.context?.status ?? "-"}</div>
        </div>
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">items</span>
          <div className="font-medium">{itemCount}</div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading context…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!isLoading && !error && !data?.context && (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {summary}
    </div>
  )
}
