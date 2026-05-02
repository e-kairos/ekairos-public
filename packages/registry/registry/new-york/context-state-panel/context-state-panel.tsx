"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useOrgDb } from "@/lib/org-db-context";
import {
  useContext,
  type ContextValue,
} from "@/registry/new-york/use-context/use-context";

type ContextStatePanelProps = {
  apiUrl: string;
  contextKey?: string;
  initialContextId?: string;
  emptyLabel?: string;
  renderSummary?: (context: ContextValue) => React.ReactNode;
};

export function ContextStatePanel({
  apiUrl,
  contextKey,
  initialContextId,
  emptyLabel = "No context loaded.",
  renderSummary,
}: ContextStatePanelProps) {
  const { db } = useOrgDb();
  const context = useContext(db, {
    apiUrl,
    contextKey,
    initialContextId,
  });

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Ekairos Context
          </p>
          <p className="font-medium text-sm">{contextKey ?? initialContextId ?? emptyLabel}</p>
        </div>
        <Button size="sm" variant="outline" onClick={context.stop}>
          Stop
        </Button>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">contextId</span>
          <div className="truncate font-mono text-xs">{context.contextId ?? "-"}</div>
        </div>
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">status</span>
          <div className="font-medium">{context.contextStatus}</div>
        </div>
        <div className="rounded-md border px-3 py-2">
          <span className="text-muted-foreground">events</span>
          <div className="font-medium">{context.events.length}</div>
        </div>
      </div>

      {context.sendError && <p className="text-sm text-destructive">{context.sendError}</p>}
      {renderSummary?.(context)}
    </div>
  );
}
