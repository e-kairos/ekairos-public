import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import type { ThreadItem } from "./thread.store.js"

export const INPUT_TEXT_ITEM_TYPE = "input_text"
export const OUTPUT_TEXT_ITEM_TYPE = "output_text"
export const SYSTEM_TEXT_ITEM_TYPE = "ekairos:system"

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
    type: INPUT_TEXT_ITEM_TYPE,
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
    type: OUTPUT_TEXT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    content: {
      parts: lastMessage.parts,
    },
    createdAt: new Date().toISOString(),
  }
}

export function convertToUIMessage(item: ThreadItem): UIMessage {
  let role: "user" | "assistant" | "system"
  if (item.type === INPUT_TEXT_ITEM_TYPE) {
    role = "user"
  } else if (item.type === SYSTEM_TEXT_ITEM_TYPE) {
    role = "system"
  } else {
    role = "assistant"
  }

  return {
    id: item.id,
    role: role,
    parts: item.content.parts,
    metadata: {
      channel: item.channel,
      type: item.type,
      createdAt: item.createdAt,
    }
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
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

export type ResponseMessage = {
  id: string;
  timestamp: Date;
  modelId: string;
  headers?: Record<string, string>;
  message: ModelMessage
}

export function convertModelMessageToItem(itemId: string, message: ResponseMessage): ThreadItem {

  let type: string;
  switch (message.message.role) {
    case "user":
      type = INPUT_TEXT_ITEM_TYPE;
      break;
    case "assistant":
      type = OUTPUT_TEXT_ITEM_TYPE;
      break;
    case "system":
      type = SYSTEM_TEXT_ITEM_TYPE;
      break;
    default:
      // Fallback for roles not mapped to our item types (e.g. tool).
      type = OUTPUT_TEXT_ITEM_TYPE;
      break;
  }

  return {
    id: itemId,
    type: type,
    channel: WEB_CHANNEL,
    content: {
      parts: message.message.content,
    },
    createdAt: message.timestamp.toISOString(),
  }
}
