import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import type { ThreadItem } from "./thread.store.js"

export const INPUT_ITEM_TYPE = "input"
export const OUTPUT_ITEM_TYPE = "output"

export const WEB_CHANNEL = "web"
export const AGENT_CHANNEL = "whatsapp"
export const EMAIL_CHANNEL = "email"

export function createUserItemFromUIMessages(messages: UIMessage[]): ThreadItem {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing messages to create item")
  }

  const lastMessage = messages[messages.length - 1]

  return {
    id: lastMessage.id,
    type: INPUT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    content: {
      parts: lastMessage.parts,
    },
    createdAt: new Date().toISOString(),
  }
}

export function createAssistantItemFromUIMessages(itemId: string, messages: UIMessage[]): ThreadItem {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing messages to create item")
  }

  const lastMessage = messages[messages.length - 1]

  return {
    id: itemId,
    type: OUTPUT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    content: {
      parts: lastMessage.parts,
    },
    createdAt: new Date().toISOString(),
  }
}

export function convertToUIMessage(item: ThreadItem): UIMessage {
  const role: "user" | "assistant" = item.type === INPUT_ITEM_TYPE ? "user" : "assistant"

  const parts = Array.isArray(item.content.parts)
    ? (item.content.parts as UIMessage["parts"])
    : []

  return {
    id: item.id,
    role,
    parts,
    metadata: {
      channel: item.channel,
      type: item.type,
      createdAt: item.createdAt,
    },
  }
}

/**
 * Converts stored ThreadItems to AI SDK ModelMessages.
 *
 * IMPORTANT:
 * - Store-agnostic and workflow-safe.
 * - Attachment/document handling MUST happen in the store boundary:
 *   `ThreadStore.itemsToModelMessages(items)`.
 */
export async function convertItemsToModelMessages(
  items: ThreadItem[],
): Promise<ModelMessage[]> {
  const results: ModelMessage[][] = []
  for (const item of items) {
    results.push(await convertItemToModelMessages(item))
  }
  return results.flat()
}

export async function convertItemToModelMessages(
  item: ThreadItem,
): Promise<ModelMessage[]> {
  const message = convertToUIMessage(item)
  return convertToModelMessages([message])
}

export type AIMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: Date
}

export type ResponseMessage = {
  id: string
  timestamp: Date
  modelId: string
  headers?: Record<string, string>
  message: ModelMessage
}

function normalizeModelMessageContentToParts(content: ModelMessage["content"]): unknown[] {
  if (Array.isArray(content)) return content as unknown[]
  if (typeof content === "string") {
    if (!content.trim()) return []
    return [{ type: "text", text: content }]
  }
  if (content === null || content === undefined) return []
  return [content as unknown]
}

export function convertModelMessageToItem(itemId: string, message: ResponseMessage): ThreadItem {
  const role = message.message.role
  const type = role === "user" ? INPUT_ITEM_TYPE : OUTPUT_ITEM_TYPE

  return {
    id: itemId,
    type,
    channel: WEB_CHANNEL,
    content: {
      parts: normalizeModelMessageContentToParts(message.message.content),
    },
    createdAt: message.timestamp.toISOString(),
  }
}
