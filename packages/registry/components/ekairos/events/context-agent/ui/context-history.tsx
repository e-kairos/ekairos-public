"use client";

import { History, MessageSquare, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { ContextHistoryItem } from "../types";

function formatRelativeTime(dateInput: Date | string | number): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "hace un momento";
  if (diffInSeconds < 3600) return `hace ${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400) return `hace ${Math.floor(diffInSeconds / 3600)} h`;
  if (diffInSeconds < 604800) return `hace ${Math.floor(diffInSeconds / 86400)} d`;
  return date.toLocaleDateString();
}

type ContextHistoryProps = {
  history: ContextHistoryItem[];
  selectedContextId?: string | null;
  onContextSelect: (contextId: string) => void;
  onDeleteContext?: (contextId: string) => void;
  className?: string;
};

export function ContextHistory({
  history,
  selectedContextId,
  onContextSelect,
  onDeleteContext,
  className,
}: ContextHistoryProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9", className)}
          title="Historial"
        >
          <History className="h-4 w-4" />
          <span className="sr-only">Historial</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b bg-muted/50 p-3">
          <h4 className="text-sm font-medium">Historial de contextos</h4>
        </div>
        <div className="max-h-[300px] space-y-1 overflow-y-auto p-2">
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No hay contextos recientes
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50",
                  selectedContextId === item.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
                data-context-history-item="true"
                data-context-id={item.id}
                data-selected={selectedContextId === item.id ? "true" : "false"}
                onClick={() => onContextSelect(item.id)}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {item.title || "Nuevo contexto"}
                  </div>
                  <div className="truncate text-[10px] opacity-70">
                    {formatRelativeTime(item.createdAt)}
                  </div>
                </div>
                {onDeleteContext ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteContext(item.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
