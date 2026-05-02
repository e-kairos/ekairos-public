"use client";

import React, { Suspense, useMemo } from "react";

import { useContext } from "../context";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { cn } from "@/lib/utils";
import { useOrgDb } from "@/lib/org-db-context";

import type { AgentProps } from "./types";
import { AgentPromptBridgeProvider } from "./agent-prompt-bridge";
import { MessageList } from "./ui/message-list";
import { PromptBar } from "./ui/prompt-bar";

export type { AgentProps, ContextHistoryItem } from "./types";

export default function ContextAgent(props: AgentProps) {
  const {
    apiUrl,
    initialContextId,
    contextKey,
    onContextUpdate,
    prepareAppendArgs,
    prepareRequestBody,
    streamChunkDelayMs,
    toolComponents,
    classNames,
    promptDensity = "default",
    showReasoning,
    contextLayoutMockEvents,
    contextLayoutMockReadOnly,
  } = props;

  const { db } = useOrgDb();

  const context = useContext(db, {
    apiUrl,
    initialContextId,
    contextKey,
    onContextUpdate,
    prepareAppendArgs,
    prepareRequestBody,
    streamChunkDelayMs,
  });

  const listContext = useMemo(() => {
    if (contextLayoutMockEvents === undefined) return context;
    return { ...context, events: contextLayoutMockEvents };
  }, [context, contextLayoutMockEvents]);

  const layoutMockReadOnly =
    contextLayoutMockReadOnly ??
    (contextLayoutMockEvents !== undefined && contextLayoutMockEvents.length > 0);

  const instanceId = useMemo(() => {
    const anyCrypto = (globalThis as any)?.crypto;
    const id = anyCrypto?.randomUUID?.() as string | undefined;
    return id || `context_agent_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }, []);
  void instanceId;

  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-background">
          <p className="text-sm text-muted-foreground">Loading agent...</p>
        </div>
      }
    >
      <AgentPromptBridgeProvider>
        <div
          data-testid="canvas-context-agent"
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground",
            classNames?.container
          )}
        >
          <Conversation className={cn("min-h-0 flex-1", classNames?.scrollArea)}>
            <ConversationContent
              className={cn("space-y-6 p-4 md:p-6", classNames?.conversationContent)}
            >
              <MessageList
                context={listContext}
                toolComponents={toolComponents || {}}
                classNames={classNames}
                showReasoning={showReasoning ?? true}
              />
              <div className={cn("h-4", classNames?.conversationEndSpacer)} />
            </ConversationContent>
            <ConversationScrollButton
              className={cn("bottom-20 right-8", classNames?.conversationScrollButton)}
            />
          </Conversation>

          <div
            className={cn(
              "bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60",
              classNames?.prompt
            )}
          >
            <PromptBar
              context={context}
              density={promptDensity}
              layoutMockReadOnly={layoutMockReadOnly}
            />
          </div>
        </div>
      </AgentPromptBridgeProvider>
    </Suspense>
  );
}
