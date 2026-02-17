import type { UIMessage } from "ai"

export const USER_MESSAGE_TYPE = "user.message"
export const ASSISTANT_MESSAGE_TYPE = "assistant.message"

export type AgentEventForUI = {
  id: string
  type: string
  channel: string
  createdAt: string | Date
  content: { parts: any[] }
  status?: string
}

export function convertToUIMessage(event: AgentEventForUI): UIMessage {
  let role: "user" | "assistant"
  if (event.type === USER_MESSAGE_TYPE) {
    role = "user"
  } else {
    role = "assistant"
  }

  return {
    id: event.id,
    role: role,
    parts: event.content.parts,
    metadata: {
      channel: event.channel,
      type: event.type,
      createdAt: event.createdAt,
      status: event.status,
    }
  }
}


