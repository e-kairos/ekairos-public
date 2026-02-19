"use client";

import React, { Suspense, useMemo } from "react";
import { Loader2 } from "lucide-react";

import {
  useThread,
  type UseThreadEventsHook,
} from "@/components/ekairos/thread/context";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { cn } from "@/lib/utils";
import { useOrgDb } from "@/lib/org-db-context";

import type { AgentProps } from "./types";
import { MessageList } from "./ui/message-list";
import { PromptBar } from "./ui/prompt-bar";
import { useRegisterThreadDebug } from "@/components/ekairos/thread/debug/registry";

export type { AgentHistoryItem, AgentProps } from "./types";

export function formatRelativeTime(dateInput: Date | string | number): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "hace un momento";
  if (diffInSeconds < 3600) return `hace ${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400)
    return `hace ${Math.floor(diffInSeconds / 3600)} h`;
  if (diffInSeconds < 604800)
    return `hace ${Math.floor(diffInSeconds / 86400)} d`;
  return date.toLocaleDateString();
}

const useAgentEvents: UseThreadEventsHook = (db, { contextId }) => {
  const q = db.useQuery(
    (contextId
      ? {
          thread_items: {
            $: {
              where: { "context.id": contextId as any },
              order: { createdAt: "asc" },
            },
            emails: {},
            whatsappMessages: {},
          },
        }
      : null) as any
  );

  const raw = (q as any)?.data?.thread_items ?? [];
  return { events: Array.isArray(raw) ? raw : [] };
};

export default function Agent(props: AgentProps) {
  const {
    apiUrl,
    initialContextId,
    onContextUpdate,
    enableResumableStreams,
    toolComponents,
    classNames,
    showReasoning,
  } = props;

  const { db } = useOrgDb();

  const thread = useThread(db, {
    apiUrl,
    initialContextId,
    onContextUpdate,
    enableResumableStreams,
    events: useAgentEvents,
  });

  const instanceId = useMemo(() => {
    const anyCrypto = (globalThis as any)?.crypto;
    const id = anyCrypto?.randomUUID?.() as string | undefined;
    return id || `agent_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }, []);
  useRegisterThreadDebug(instanceId, thread);

  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            <p className="text-sm text-muted-foreground">Loading Agent...</p>
          </div>
        </div>
      }
    >
      <div
        data-testid="chat-container"
        className={cn(
          "relative flex flex-col w-full h-full bg-background text-foreground overflow-hidden",
          classNames?.container
        )}
      >
        <Conversation className={cn("flex-1 min-h-0", classNames?.scrollArea)}>
          <ConversationContent className="p-4 md:p-6 space-y-6">
            <MessageList
              thread={thread}
              toolComponents={toolComponents || {}}
              classNames={classNames}
              showReasoning={showReasoning ?? true}
            />
            <div className="h-4" />
          </ConversationContent>
          <ConversationScrollButton className="bottom-20 right-8" />
        </Conversation>

        <div
          className={cn(
            "p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
            classNames?.prompt
          )}
        >
          <PromptBar thread={thread} />
        </div>
      </div>
    </Suspense>
  );
}
