import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import type { ContextItem } from "./context.store.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
  type ContextPartContent,
  type ContextPartEnvelope,
} from "./context.parts.js"

export const INPUT_ITEM_TYPE = "input"
export const OUTPUT_ITEM_TYPE = "output"
export const INPUT_TEXT_ITEM_TYPE = INPUT_ITEM_TYPE

export const WEB_CHANNEL = "web"
export const AGENT_CHANNEL = "whatsapp"
export const EMAIL_CHANNEL = "email"

export type ContextOutputContentPart =
  | {
      type: "text"
      text: string
    }
  | ({
      type: "image-data"
      data: string
      mediaType: string
      filename?: string
    } & Record<string, unknown>)
  | ({
      type: string
    } & Record<string, unknown>)

export type ContextOutputPart =
  | {
      type: "json"
      value: unknown
    }
  | {
      type: "content"
      value: ContextOutputContentPart[]
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function isContextOutputContentPart(value: unknown): value is ContextOutputContentPart {
  const record = asRecord(value)
  return Boolean(record && typeof record.type === "string")
}

export function isContextOutputPart(value: unknown): value is ContextOutputPart {
  const record = asRecord(value)
  if (!record || typeof record.type !== "string") {
    return false
  }

  if (record.type === "json") {
    return "value" in record
  }

  if (record.type === "content") {
    return Array.isArray(record.value) && record.value.every(isContextOutputContentPart)
  }

  return false
}

export function normalizeContextOutputPart(value: unknown): ContextOutputPart {
  if (isContextOutputPart(value)) {
    return value
  }

  return {
    type: "json",
    value,
  }
}

function isToolUIPart(value: unknown): value is Record<string, unknown> & { type: string } {
  const record = asRecord(value)
  return Boolean(record && typeof record.type === "string" && record.type.startsWith("tool-"))
}

function readToolNameFromPart(part: Record<string, unknown>) {
  return String(part.type).split("-").slice(1).join("-")
}

function asCanonicalParts(parts: unknown[]): ContextPartEnvelope[] {
  return normalizePartsForPersistence(parts)
}

function contentBlockToPrimaryUiParts(
  block: ContextPartContent,
): UIMessage["parts"] {
  if (block.type === "text") {
    return [{ type: "text", text: block.text }]
  }

  if (block.type === "file") {
    const url =
      typeof block.url === "string" && block.url.length > 0
        ? block.url
        : typeof block.data === "string" && block.data.length > 0
          ? block.data.startsWith("data:")
            ? block.data
            : `data:${block.mediaType};base64,${block.data}`
          : typeof block.fileId === "string" && block.fileId.length > 0
            ? block.fileId
            : ""
    if (!url) {
      return []
    }

    return [
      {
        type: "file",
        mediaType: block.mediaType,
        filename: block.filename,
        url,
      },
    ]
  }

  if (block.type === "json") {
    return [
      {
        type: "text",
        text: JSON.stringify(block.value, null, 2),
      },
    ]
  }

  if (block.type === "source-url") {
    return [
      {
        type: "source-url",
        sourceId: block.sourceId,
        url: block.url,
        title: block.title,
      },
    ]
  }

  if (block.type === "source-document") {
    return [
      {
        type: "source-document",
        sourceId: block.sourceId,
        mediaType: block.mediaType,
        title: block.title,
        filename: block.filename,
      },
    ]
  }

  return []
}

function canonicalPartsToPrimaryUiParts(parts: ContextPartEnvelope[]): UIMessage["parts"] {
  const uiParts: UIMessage["parts"] = []

  for (const part of parts) {
    if (part.type === "message") {
      if (part.content.text) {
        uiParts.push({ type: "text", text: part.content.text })
      }
      if (Array.isArray(part.content.blocks)) {
        uiParts.push(
          ...part.content.blocks.flatMap((block) => contentBlockToPrimaryUiParts(block)),
        )
      }
      continue
    }

    if (part.type === "reasoning") {
      if (part.content.text.trim()) {
        uiParts.push({
          type: "reasoning",
          text: part.content.text,
          state: part.content.state,
        })
      }
      continue
    }

    if (part.type === "source") {
      uiParts.push(...part.content.sources.flatMap((block) => contentBlockToPrimaryUiParts(block)))
      continue
    }

    if (part.type === "action" && part.content.status === "started") {
      uiParts.push({
        type: `tool-${part.content.actionName}`,
        toolCallId: part.content.actionCallId,
        state: "input-available",
        input: part.content.input,
      })
    }
  }

  return uiParts
}

function canonicalToolPartsToModelMessages(parts: ContextPartEnvelope[]): ModelMessage[] {
  const actionInputs = new Map<string, unknown>()
  const toolResults: Array<Record<string, unknown>> = []

  for (const part of parts) {
    if (part.type !== "action") {
      continue
    }

    if (part.content.status === "started") {
      actionInputs.set(part.content.actionCallId, part.content.input)
      continue
    }

    if (part.content.status === "failed") {
      toolResults.push({
        type: "tool-error",
        toolCallId: part.content.actionCallId,
        toolName: part.content.actionName,
        input: actionInputs.get(part.content.actionCallId),
        error: part.content.error.message || "Action execution failed.",
      })
      continue
    }

    toolResults.push({
      type: "tool-result",
      toolCallId: part.content.actionCallId,
      toolName: part.content.actionName,
      output: normalizeContextOutputPart(part.content.output),
    })
  }

  if (toolResults.length === 0) {
    return []
  }

  return [
    {
      role: "tool",
      content: toolResults,
    } as unknown as ModelMessage,
  ]
}

function canonicalPartsToModelMessages(role: "user" | "assistant", parts: ContextPartEnvelope[]) {
  const uiMessage = {
    id: "canonical-item",
    role,
    parts: canonicalPartsToPrimaryUiParts(parts),
  } satisfies UIMessage

  return removeEmptyToolMessages(convertToModelMessages([uiMessage]))
}

function normalizeAssistantPartsForModel(parts: unknown[]): UIMessage["parts"] {
  return parts
    .map((part) => {
      if (!isToolUIPart(part)) {
        return part as UIMessage["parts"][number]
      }

      const next = {
        ...part,
        state:
          part.state === "output-available" || part.state === "output-error"
            ? "input-available"
            : part.state,
      } as Record<string, unknown>

      delete next.output
      delete next.errorText
      return next as UIMessage["parts"][number]
    })
    .filter(Boolean)
}

function buildToolResultContent(parts: unknown[]): Array<Record<string, unknown>> {
  const toolContent: Array<Record<string, unknown>> = []

  for (const part of parts) {
    if (!isToolUIPart(part)) {
      continue
    }

    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : ""
    const toolName = readToolNameFromPart(part)

    if (!toolCallId || !toolName) {
      continue
    }

    if (part.state === "output-available") {
      toolContent.push({
        type: "tool-result",
        toolCallId,
        toolName,
        output: normalizeContextOutputPart(part.output),
      })
      continue
    }

    if (part.state === "output-error") {
      toolContent.push({
        type: "tool-error",
        toolCallId,
        toolName,
        input: part.input,
        error:
          typeof part.errorText === "string" && part.errorText.trim().length > 0
            ? part.errorText
            : "Tool execution failed.",
      })
    }
  }

  return toolContent
}

function removeEmptyToolMessages(messages: ModelMessage[]) {
  return messages.filter((message) => {
    if (message.role !== "tool") {
      return true
    }

    return Array.isArray(message.content) ? message.content.length > 0 : true
  })
}

export function createUserItemFromUIMessages(messages: UIMessage[]): ContextItem {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing messages to create item")
  }

  const lastMessage = messages[messages.length - 1]

  return {
    id: lastMessage.id,
    type: INPUT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    content: {
      parts: asCanonicalParts(lastMessage.parts),
    },
    createdAt: new Date().toISOString(),
  }
}

export function createAssistantItemFromUIMessages(itemId: string, messages: UIMessage[]): ContextItem {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing messages to create item")
  }

  const lastMessage = messages[messages.length - 1]

  return {
    id: itemId,
    type: OUTPUT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    content: {
      parts: asCanonicalParts(lastMessage.parts),
    },
    createdAt: new Date().toISOString(),
  }
}

export function convertToUIMessage(item: ContextItem): UIMessage {
  const role: "user" | "assistant" = item.type === INPUT_ITEM_TYPE ? "user" : "assistant"

  const rawParts = Array.isArray(item.content.parts) ? item.content.parts : []
  const parts = rawParts.every(isContextPartEnvelope)
    ? canonicalPartsToPrimaryUiParts(rawParts as ContextPartEnvelope[])
    : (rawParts as UIMessage["parts"])

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
 * Converts stored ContextItems to AI SDK ModelMessages.
 *
 * IMPORTANT:
 * - Store-agnostic and workflow-safe.
 * - Attachment/document handling MUST happen in the store boundary:
 *   `ContextStore.itemsToModelMessages(items)`.
 */
export async function convertItemsToModelMessages(
  items: ContextItem[],
): Promise<ModelMessage[]> {
  const results: ModelMessage[][] = []
  for (const item of items) {
    results.push(await convertItemToModelMessages(item))
  }
  return results.flat()
}

export async function convertItemToModelMessages(
  item: ContextItem,
): Promise<ModelMessage[]> {
  const role: "user" | "assistant" = item.type === INPUT_ITEM_TYPE ? "user" : "assistant"
  const rawParts = Array.isArray(item.content.parts) ? item.content.parts : []
  const canonicalParts = asCanonicalParts(rawParts)

  if (canonicalParts.length > 0) {
    const primary = await canonicalPartsToModelMessages(role, canonicalParts)
    if (role !== "assistant") {
      return primary
    }

    return [
      ...primary,
      ...canonicalToolPartsToModelMessages(canonicalParts),
    ]
  }

  const assistantParts = normalizeAssistantPartsForModel(rawParts)
  const message = {
    id: item.id,
    role,
    parts: assistantParts,
  } satisfies UIMessage
  const modelMessages = removeEmptyToolMessages(await convertToModelMessages([message]))

  if (role !== "assistant") {
    return modelMessages
  }

  const toolContent = buildToolResultContent(rawParts)
  if (toolContent.length === 0) {
    return modelMessages
  }

  return [
    ...modelMessages,
    {
      role: "tool",
      content: toolContent,
    } as unknown as ModelMessage,
  ]
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

export function convertModelMessageToItem(itemId: string, message: ResponseMessage): ContextItem {
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
