"use client";

import React, { memo, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import {
  INPUT_TEXT_ITEM_TYPE,
  type ContextEventForUI,
  type ContextValue,
} from "../../context";
import { MessageParts } from "./message-parts";
import { ContextStepList } from "./context-step-list";

import type { AgentClassNames } from "../types";

type MessageListProps = {
  context: ContextValue;
  toolComponents: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning: boolean;
  renderMessageActions?: (params: {
    message: any;
    status: "streaming" | "ready";
    isLatest: boolean;
  }) => ReactNode;
};

const MessageList = memo(function MessageList({
  context,
  toolComponents,
  classNames,
  showReasoning,
  renderMessageActions,
}: MessageListProps) {
  const { events, contextStatus, sendStatus } = context;

  const messages = useMemo(() => {
    const toMessage = (event: ContextEventForUI) => {
      const type = String(event?.type ?? "");
      const role =
        type === INPUT_TEXT_ITEM_TYPE || type === "input" || type.startsWith("user.")
          ? "user"
          : "assistant";
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
        steps: event.steps ?? [],
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
    contextStatus === "open_streaming" || sendStatus === "submitting";
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
        const hasSteps =
          message.role === "assistant" &&
          Array.isArray(message.steps) &&
          message.steps.length > 0;
        const status =
          isLatest && isTurnStreaming && message?.role === "assistant"
            ? "streaming"
            : "ready";

        return (
          <div
            key={String(message?.id)}
            className={classNames?.message?.container}
          >
            {!hasSteps ? (
              <MessageParts
                message={message}
                status={status}
                isLatest={isLatest}
                toolComponents={toolComponents}
                classNames={classNames}
                showReasoning={showReasoning}
              />
            ) : null}
            {hasSteps ? (
              <ContextStepList
                steps={message.steps}
                toolComponents={toolComponents}
                classNames={classNames}
                showReasoning={showReasoning}
              />
            ) : null}
            {renderMessageActions
              ? renderMessageActions({ message, status, isLatest })
              : null}
          </div>
        );
      })}
    </div>
  );
});

export { MessageList };
