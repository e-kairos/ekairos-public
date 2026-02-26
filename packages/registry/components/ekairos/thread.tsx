import React from "react";
import {
  Conversation as AIEConversation,
  ConversationContent as AIEConversationContent,
  ConversationScrollButton as AIEConversationScrollButton,
} from "@/components/ai-elements/conversation";

export type ThreadProps = React.ComponentProps<typeof AIEConversation>;

export function Thread(props: ThreadProps) {
  return <AIEConversation {...props} />;
}

export const ThreadContent = AIEConversationContent;
export const ThreadScrollButton = AIEConversationScrollButton;
