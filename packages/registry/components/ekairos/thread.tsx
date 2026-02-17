import React from "react"
import {
  Conversation as AIEConversation,
  ConversationContent as AIEConversationContent,
  ConversationScrollButton as AIEConversationScrollButton,
} from "@/components/ai-elements/conversation"

export function Thread({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <AIEConversation className={className}>{children as any}</AIEConversation>
  )
}

export const ThreadContent = AIEConversationContent
export const ThreadScrollButton = AIEConversationScrollButton



