import type { ContextItem } from "@ekairos/events"
import { Sandbox } from "@ekairos/sandbox/sandbox"

export type AnyRecord = Record<string, unknown>

export function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

export function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function cleanRecord(value: AnyRecord): AnyRecord {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function codexProviderMetadata(params: {
  source: string
  sequence: number
  at?: string
  providerThreadId?: string
  providerTurnId?: string
  providerItemId?: string
  providerToolType?: string
  success?: boolean
  response?: unknown
  errorText?: string
}) {
  return cleanRecord({
    source: params.source,
    sequence: params.sequence,
    at: params.at ?? "",
    provider: {
      codex: cleanRecord({
        threadId: params.providerThreadId,
        turnId: params.providerTurnId,
        itemId: params.providerItemId,
        toolType: params.providerToolType,
        success: params.success,
        response: params.response,
        errorText: params.errorText,
      }),
    },
  })
}

function normalizeCodexToolOutputContent(value: unknown): AnyRecord[] {
  if (value === undefined || value === null) return []
  if (typeof value === "string") return [{ type: "text", text: value }]

  const record = asRecord(value)
  if (!record || Object.keys(record).length === 0) {
    return [{ type: "json", value }]
  }

  if (record.type === "content" && Array.isArray(record.value)) {
    const out: AnyRecord[] = []
    for (const entry of record.value) {
      const block = asRecord(entry)
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ type: "text", text: block.text })
        continue
      }
      if (block.type === "image-data") {
        out.push(
          cleanRecord({
            type: "file",
            mediaType: asString(block.mediaType) || "application/octet-stream",
            filename: asString(block.filename) || undefined,
            data: typeof block.data === "string" ? block.data : undefined,
          }),
        )
        continue
      }
      if (block.type === "file") {
        out.push(
          cleanRecord({
            type: "file",
            mediaType: asString(block.mediaType) || "application/octet-stream",
            filename: asString(block.filename) || undefined,
            data: typeof block.data === "string" ? block.data : undefined,
            url: typeof block.url === "string" ? block.url : undefined,
            fileId: typeof block.fileId === "string" ? block.fileId : undefined,
          }),
        )
        continue
      }
      out.push({ type: "json", value: entry })
    }
    return out
  }

  if (record.type === "file") {
    return [
      cleanRecord({
        type: "file",
        mediaType: asString(record.mediaType) || "application/octet-stream",
        filename: asString(record.filename) || undefined,
        data: typeof record.data === "string" ? record.data : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        fileId: typeof record.fileId === "string" ? record.fileId : undefined,
      }),
    ]
  }

  return [{ type: "json", value }]
}

function normalizeCodexToolErrorContent(output: AnyRecord, response: AnyRecord): AnyRecord[] {
  const errorText =
    asString(output.errorText) ||
    asString(asRecord(output.output).error) ||
    asString(asRecord(response).error) ||
    "Tool execution failed."
  return [{ type: "text", text: errorText }]
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  const out: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    const partType = asString(record.type)
    if (partType === "text") {
      const value = asString(record.text).trim()
      if (value) out.push(value)
      continue
    }
    if (partType === "input_text") {
      const value = asString(record.input_text || record.text).trim()
      if (value) out.push(value)
      continue
    }
    const inline = asString(record.text).trim()
    if (inline) out.push(inline)
  }
  return out.join("\n").trim()
}

export function defaultInstructionFromTrigger(event: ContextItem): string {
  const content = asRecord(event.content)
  const message = textFromParts(content.parts)
  return message || "Continue with the current task."
}

export function buildCodexParts(params: {
  toolName: string
  includeReasoningPart: boolean
  completedOnly?: boolean
  semanticChunks?: unknown[]
  rawChunks?: unknown[]
  result: {
    providerContextId: string
    turnId: string
    assistantText: string
    reasoningText?: string
    diff?: string
    toolParts?: unknown[]
    metadata?: Record<string, unknown>
  }
  instruction: string
  streamTrace?: unknown
}) {
  const parts: Array<{ sequence: number; part: AnyRecord }> = []
  const streamTrace = asRecord(params.streamTrace)
  const capturedChunks =
    asArray<AnyRecord>(params.rawChunks).length > 0
      ? asArray<AnyRecord>(params.rawChunks)
      : asArray<AnyRecord>(params.semanticChunks).length > 0
        ? asArray<AnyRecord>(params.semanticChunks)
        : asArray<AnyRecord>(streamTrace.chunks)
  const semanticChunks =
    asArray<AnyRecord>(params.semanticChunks).length > 0
      ? asArray<AnyRecord>(params.semanticChunks)
      : asArray<AnyRecord>(streamTrace.chunks)

  const lastChunkSequence = capturedChunks.reduce((max, chunk) => {
    const sequence = typeof chunk.sequence === "number" ? chunk.sequence : 0
    return Math.max(max, sequence)
  }, 0)

  function findLastChunk(
    predicate: (chunk: AnyRecord) => boolean,
  ): { sequence: number; at: string } | null {
    for (let index = capturedChunks.length - 1; index >= 0; index -= 1) {
      const chunk = capturedChunks[index]
      if (!predicate(chunk)) continue
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
      }
    }
    return null
  }

  const turnCompletedChunk = findLastChunk((chunk) => {
    const data = asRecord(chunk.data)
    const method = asString(data.method)
    return method === "turn/completed"
  })

  const completedAgentMessages = semanticChunks
    .map((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      const paramsRecord = asRecord(data.params)
      const item = asRecord(paramsRecord.item)
      if (method !== "item/completed" || asString(item.type) !== "agentMessage") return null
      const text = asString(item.text).trim()
      if (!text) return null
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
        itemId: asString(item.id),
        text,
      }
    })
    .filter(Boolean) as Array<{ sequence: number; at: string; itemId: string; text: string }>

  const reasoningFromStream = capturedChunks
    .filter((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta"
    })
    .map((chunk) => asString(asRecord(asRecord(chunk.data).params).delta))
    .join("")
    .trim()
  const completedReasoningItems = semanticChunks
    .map((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      const paramsRecord = asRecord(data.params)
      const item = asRecord(paramsRecord.item)
      if (method !== "item/completed" || asString(item.type) !== "reasoning") return null
      const text = asString(item.summary || item.text).trim()
      if (!text) return null
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
        itemId: asString(item.id),
        text,
      }
    })
    .filter(Boolean) as Array<{ sequence: number; at: string; itemId: string; text: string }>

  for (const message of completedAgentMessages) {
    if (params.completedOnly === true || params.completedOnly === false || params.completedOnly === undefined) {
      parts.push({
        sequence: message.sequence,
        part: {
          type: "text",
          text: message.text,
          metadata: {
            source: "codex.timeline",
            sequence: message.sequence,
            at: message.at,
            itemId: message.itemId,
          },
        },
      })
    }
  }

  if (params.includeReasoningPart && reasoningFromStream) {
    const lastReasoningChunk = findLastChunk((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta"
    })
    parts.push({
      sequence: lastReasoningChunk?.sequence ?? lastChunkSequence + 1,
      part: {
        type: "reasoning",
        text: reasoningFromStream,
        metadata: {
          source: "codex.timeline.full",
          sequence: lastReasoningChunk?.sequence ?? lastChunkSequence + 1,
          at: lastReasoningChunk?.at ?? "",
        },
      },
    })
  } else if (params.includeReasoningPart) {
    for (const reasoningItem of completedReasoningItems) {
      parts.push({
        sequence: reasoningItem.sequence,
        part: {
          type: "reasoning",
          text: reasoningItem.text,
          metadata: {
            source: "codex.timeline",
            sequence: reasoningItem.sequence,
            at: reasoningItem.at,
            itemId: reasoningItem.itemId,
          },
        },
      })
    }
  }

  const commands = new Map<
    string,
    {
      input?: AnyRecord
      outputText?: string
      completed?: AnyRecord
      sequence?: number
      at?: string
    }
  >()
  const dynamicTools = new Map<
    string,
    {
      input?: AnyRecord
      output?: AnyRecord
      sequence?: number
      at?: string
    }
  >()

  for (const chunk of capturedChunks) {
    const data = asRecord(chunk.data)
    const method = asString(data.method)
    const paramsRecord = asRecord(data.params)
    if (method === "item/tool/call") {
      const toolCallId = asString(paramsRecord.callId)
      if (toolCallId) {
        dynamicTools.set(toolCallId, {
          ...(dynamicTools.get(toolCallId) ?? {}),
          input: paramsRecord,
          sequence:
            typeof chunk.sequence === "number" ? chunk.sequence : undefined,
          at: asString(chunk.at),
        })
      }
      continue
    }
    if (method === "item/tool/result") {
      const toolCallId = asString(paramsRecord.callId)
      if (toolCallId) {
        const current = dynamicTools.get(toolCallId) ?? {}
        current.output = paramsRecord
        current.sequence =
          typeof chunk.sequence === "number"
            ? Math.max(current.sequence ?? 0, chunk.sequence)
            : current.sequence
        current.at = asString(chunk.at) || current.at
        dynamicTools.set(toolCallId, current)
      }
      continue
    }
    if (method === "item/started") {
      const item = asRecord(paramsRecord.item)
      if (asString(item.type) === "commandExecution") {
        commands.set(asString(item.id), {
          ...(commands.get(asString(item.id)) ?? {}),
          input: item,
          sequence:
            typeof chunk.sequence === "number" ? chunk.sequence : undefined,
          at: asString(chunk.at),
        })
      }
      continue
    }
    if (method === "item/commandExecution/outputDelta") {
      const itemId = asString(paramsRecord.itemId)
      if (!itemId) continue
      const current = commands.get(itemId) ?? {}
      current.outputText = `${current.outputText ?? ""}${asString(paramsRecord.delta)}`
      current.sequence =
        typeof chunk.sequence === "number"
          ? Math.max(current.sequence ?? 0, chunk.sequence)
          : current.sequence
      current.at = asString(chunk.at) || current.at
      commands.set(itemId, current)
      continue
    }
    if (method === "item/completed") {
      const item = asRecord(paramsRecord.item)
      if (asString(item.type) === "commandExecution") {
        const itemId = asString(item.id)
        const current = commands.get(itemId) ?? {}
        current.completed = item
        current.sequence =
          typeof chunk.sequence === "number"
            ? Math.max(current.sequence ?? 0, chunk.sequence)
            : current.sequence
        current.at = asString(chunk.at) || current.at
        commands.set(itemId, current)
      }
    }
  }

  if (completedAgentMessages.length === 0) {
    const assistantText = asString(params.result.assistantText).trim()
    if (assistantText && !params.completedOnly) {
      parts.push({
        sequence: lastChunkSequence + 1,
        part: {
          type: "text",
          text: assistantText,
          metadata: {
            source: "codex.timeline.fallback",
            sequence: lastChunkSequence + 1,
            at: "",
          },
        },
      })
    }
  }

  if (
    params.includeReasoningPart &&
    !reasoningFromStream &&
    completedReasoningItems.length === 0
  ) {
    const reasoningText = asString(params.result.reasoningText || reasoningFromStream).trim()
    if (reasoningText && !params.completedOnly) {
      parts.push({
        sequence: lastChunkSequence + 1,
        part: {
          type: "reasoning",
          text: reasoningText,
          metadata: {
            source: "codex.timeline.fallback",
            sequence: lastChunkSequence + 1,
            at: "",
          },
        },
      })
    }
  }

  for (const [toolCallId, command] of commands.entries()) {
    const input = asRecord(command.input)
    const completed = asRecord(command.completed)
    const outputText = asString(completed.aggregatedOutput || command.outputText).trim()
    const status = asString(completed.status || input.status || "completed").trim()
    const exitCode =
      typeof completed.exitCode === "number" ? completed.exitCode : undefined
    const resultMetadata = asRecord(params.result.metadata)
    const sandboxMetadata = asRecord(resultMetadata.sandbox)
    const sandboxId = asString(sandboxMetadata.sandboxId).trim()
    const commandText = asString(input.command)
    const failed = status === "failed" || (typeof exitCode === "number" && exitCode !== 0)
    const errorText =
      status === "failed"
        ? asString(completed.error || completed.message || "command_execution_failed")
        : undefined
    const reactorMetadata = cleanRecord({
      reactorKind: "codex",
      ...codexProviderMetadata({
        source: "codex.timeline",
        sequence: command.sequence ?? 0,
        at: command.at,
        providerItemId: toolCallId,
        providerToolType: "commandExecution",
        success: !failed,
        errorText,
      }),
    })
    parts.push({
      sequence: command.sequence ?? 0,
      part: {
        type: "action",
        content: {
          status: "started",
          actionName: Sandbox.runCommandActionName,
          actionCallId: toolCallId,
          input: cleanRecord({
            command: commandText,
            cwd: asString(input.cwd) || undefined,
            metadata: cleanRecord({
              commandActions: asArray(input.commandActions),
            }),
          }),
        },
        reactorMetadata,
      },
    })
    if (!command.completed) continue
    parts.push({
      sequence: (command.sequence ?? 0) + 0.1,
      part: {
        type: "action",
        content: {
          status: "completed",
          actionName: Sandbox.runCommandActionName,
          actionCallId: toolCallId,
          output: cleanRecord({
            sandboxId: sandboxId || undefined,
            success: !failed,
            exitCode,
            output: outputText || undefined,
            error: failed ? errorText : undefined,
            command: commandText || undefined,
            durationMs:
              typeof completed.durationMs === "number" ? completed.durationMs : undefined,
            status,
          }),
        },
        reactorMetadata,
      },
    })
  }

  for (const [toolCallId, toolCall] of dynamicTools.entries()) {
    const input = asRecord(toolCall.input)
    const output = asRecord(toolCall.output)
    const result = asRecord(output.result)
    const toolName = asString(input.tool).trim() || "dynamicTool"
    const success = result.success !== false && !asString(output.errorText)
    const callSequence = toolCall.sequence ?? 0
    const providerThreadId = asString(input.threadId)
    const providerTurnId = asString(input.turnId)
    const providerResponse = Object.keys(result).length > 0 ? result : undefined

    parts.push({
      sequence: callSequence,
      part: {
        type: "tool-call",
        toolName,
        toolCallId,
        state: "input-available",
        content: [
          {
            type: "json",
            value: input.arguments ?? {},
          },
        ],
        metadata: codexProviderMetadata({
          source: "codex.dynamic_tool",
          sequence: callSequence,
          at: toolCall.at,
          providerThreadId,
          providerTurnId,
          providerItemId: toolCallId,
          providerToolType: "dynamicTool",
        }),
      },
    })
    if (toolCall.output) {
      parts.push({
        sequence: callSequence + 0.1,
        part: {
          type: "tool-result",
          toolName,
          toolCallId,
          state: success ? "output-available" : "output-error",
          content: success
            ? normalizeCodexToolOutputContent(output.output)
            : normalizeCodexToolErrorContent(output, result),
          metadata: codexProviderMetadata({
            source: "codex.dynamic_tool",
            sequence: callSequence,
            at: toolCall.at,
            providerThreadId,
            providerTurnId,
            providerItemId: toolCallId,
            providerToolType: "dynamicTool",
            success,
            response: providerResponse,
            errorText: asString(output.errorText) || undefined,
          }),
        },
      })
    }
  }

  const tokenUsageChunk = [...semanticChunks]
    .reverse()
    .find((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated"
    })
  const tokenUsage = tokenUsageChunk
    ? asRecord(asRecord(asRecord(tokenUsageChunk.data).params).tokenUsage)
    : {}

  if (!params.completedOnly || turnCompletedChunk) {
    parts.push({
      sequence: turnCompletedChunk?.sequence ?? lastChunkSequence + 1,
      part: {
        type: "tool-turnMetadata",
        toolName: "turnMetadata",
        toolCallId: params.result.turnId || params.result.providerContextId,
        state: "output-available",
        input: { instruction: params.instruction },
        output: {
          providerContextId: params.result.providerContextId,
          turnId: params.result.turnId,
          diff: params.result.diff ?? "",
          tokenUsage,
          streamTrace: params.streamTrace,
          ...(params.result.metadata ?? {}),
        },
        metadata: {
          source: "codex.timeline",
          sequence: turnCompletedChunk?.sequence ?? lastChunkSequence + 1,
          at: turnCompletedChunk?.at ?? "",
        },
      },
    })
  }

  return parts
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.part)
}

