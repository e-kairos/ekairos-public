import React from "react";
import {
  Conversation as AIEConversation,
  ConversationContent as AIEConversationContent,
  ConversationScrollButton as AIEConversationScrollButton,
} from "@/components/ai-elements/conversation";

export type ContextProps = React.ComponentProps<typeof AIEConversation>;

export function Context(props: ContextProps) {
  return <AIEConversation {...props} />;
}

export const ContextContent = AIEConversationContent;
export const ContextScrollButton = AIEConversationScrollButton;
