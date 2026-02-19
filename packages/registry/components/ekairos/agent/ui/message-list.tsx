"use client";

import React, { memo, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  INPUT_TEXT_ITEM_TYPE,
  type ContextEventForUI,
  type ThreadValue,
} from "@/components/ekairos/thread/context";

import type { AgentClassNames } from "../types";
import { MessageParts } from "./message-parts";

type MessageListProps = {
  thread: ThreadValue;
  toolComponents: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning: boolean;
};

const MessageList = memo(function MessageList({
  thread,
  toolComponents,
  classNames,
  showReasoning,
}: MessageListProps) {
  const { events, contextStatus, sendStatus } = thread;

  const messages = useMemo(() => {
    const toMessage = (event: ContextEventForUI) => {
      const role = event.type === INPUT_TEXT_ITEM_TYPE ? "user" : "assistant";
      return {
        id: event.id,
        role,
        parts: event.content?.parts || [],
        metadata: {
          channel: event.channel,
          type: event.type,
          createdAt: event.createdAt,
          eventId: event.id,
          status: event.status,
          emails: event.emails,
          whatsappMessages: event.whatsappMessages,
        },
      };
    };

    return events.map(toMessage);
  }, [events]);

  const [visibleCount, setVisibleCount] = useState(100);
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleCount)),
    [messages, visibleCount]
  );

  const shouldShowTurnIndicator =
    contextStatus === "streaming" || sendStatus === "submitting";
  const isTurnStreaming = shouldShowTurnIndicator;

  return (
    <div
      className={cn(
        "w-full max-w-3xl mx-auto space-y-6",
        classNames?.messageList
      )}
    >
      {messages.length > visibleCount && (
        <div className="flex justify-center">
          <button
            onClick={() => setVisibleCount((prev) => prev + 100)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Load older messages
          </button>
        </div>
      )}

      {visibleMessages.map((message: any) => {
        const isLatest = message === visibleMessages[visibleMessages.length - 1];
        const status =
          isLatest && isTurnStreaming && message?.role === "assistant"
            ? "streaming"
            : "ready";

        return (
          <div
            key={String(message?.id)}
            className={classNames?.message?.container}
          >
            <MessageParts
              message={message}
              status={status}
              isLatest={isLatest}
              toolComponents={toolComponents}
              classNames={classNames}
              showReasoning={showReasoning}
            />
          </div>
        );
      })}

      {shouldShowTurnIndicator && (
        <div className="flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Procesando" />
        </div>
      )}
    </div>
  );
});

export { MessageList };

