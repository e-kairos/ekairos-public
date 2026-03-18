type AnyRecord = Record<string, unknown>;

type EventWithParts = {
  id?: string;
  type?: string;
  channel?: string;
  createdAt?: string | Date;
  status?: string;
  content?: {
    parts?: unknown[];
  };
};

const CONTEXT_STEP_STREAM_VERSION = 1;

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

export function parsePersistedCodexStreamChunk(
  value: string | Record<string, unknown>,
) {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const row = asRecord(parsed);
  const version = typeof row.version === "number" ? row.version : -1;
  if (version !== CONTEXT_STEP_STREAM_VERSION) {
    throw new Error(`Unsupported persisted stream chunk version: ${String(row.version)}`);
  }
  const at = asString(row.at);
  const chunkType = asString(row.chunkType);
  if (!at || !chunkType) {
    throw new Error("Invalid persisted stream chunk.");
  }
  return row;
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function countByChunkKey(
  chunks: Array<AnyRecord>,
  key: "chunkType" | "providerChunkType",
) {
  return chunks.reduce<Record<string, number>>((acc, chunk) => {
    const label = asString(chunk[key]) || "unknown";
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
}

function readParts(event: EventWithParts | null | undefined) {
  return asArray<AnyRecord>(event?.content?.parts);
}

function findPartByType(event: EventWithParts | null | undefined, partType: string) {
  return readParts(event).find((part) => asString(part.type) === partType) ?? null;
}

function normalizeCountMap(value: unknown) {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const numeric = asFiniteNumber(entry);
    if (numeric !== null) {
      out[key] = numeric;
    }
  }
  return out;
}

function getNestedRecord(source: unknown, key: string) {
  const nested = asRecord(source)[key];
  return nested && typeof nested === "object" ? asRecord(nested) : {};
}

export function getCommandExecutionParts(event: EventWithParts | null | undefined) {
  return readParts(event).filter((part) => asString(part.type) === "tool-commandExecution");
}

export function getCommandExecutionPartsFromStreamTrace(streamTraceInput: unknown) {
  const streamTrace = asRecord(streamTraceInput);
  const capturedChunks = asArray<AnyRecord>(streamTrace.chunks);
  const commands = new Map<
    string,
    {
      input?: AnyRecord;
      outputText?: string;
      completed?: AnyRecord;
      sequence?: number;
      at?: string;
    }
  >();

  for (const chunk of capturedChunks) {
    const data = asRecord(chunk.data);
    const method = asString(data.method);
    const paramsRecord = asRecord(data.params);
    if (method === "item/started") {
      const item = asRecord(paramsRecord.item);
      if (asString(item.type) === "commandExecution") {
        commands.set(asString(item.id), {
          ...(commands.get(asString(item.id)) ?? {}),
          input: item,
          sequence:
            typeof chunk.sequence === "number" ? chunk.sequence : undefined,
          at: asString(chunk.at),
        });
      }
      continue;
    }
    if (method === "item/commandExecution/outputDelta") {
      const itemId = asString(paramsRecord.itemId);
      if (!itemId) continue;
      const current = commands.get(itemId) ?? {};
      current.outputText = `${current.outputText ?? ""}${asString(paramsRecord.delta)}`;
      current.sequence =
        typeof chunk.sequence === "number"
          ? Math.max(current.sequence ?? 0, chunk.sequence)
          : current.sequence;
      current.at = asString(chunk.at) || current.at;
      commands.set(itemId, current);
      continue;
    }
    if (method === "item/completed") {
      const item = asRecord(paramsRecord.item);
      if (asString(item.type) === "commandExecution") {
        const itemId = asString(item.id);
        const current = commands.get(itemId) ?? {};
        current.completed = item;
        current.sequence =
          typeof chunk.sequence === "number"
            ? Math.max(current.sequence ?? 0, chunk.sequence)
            : current.sequence;
        current.at = asString(chunk.at) || current.at;
        commands.set(itemId, current);
      }
    }
  }

  return Array.from(commands.entries()).map(([toolCallId, command]) => {
    const input = asRecord(command.input);
    const completed = asRecord(command.completed);
    const isCompleted = Object.keys(completed).length > 0;
    const outputText = asString(completed.aggregatedOutput || command.outputText);
    const status = asString(completed.status || input.status).trim();
    const exitCode =
      typeof completed.exitCode === "number" ? completed.exitCode : undefined;
    const resolvedStatus =
      status ||
      (isCompleted ? "completed" : outputText.trim().length > 0 ? "running" : "pending");
    const state =
      isCompleted
        ? resolvedStatus === "failed" || (typeof exitCode === "number" && exitCode !== 0)
          ? "output-error"
          : "output-available"
        : outputText.trim().length > 0
          ? "output-streaming"
          : Object.keys(input).length > 0
            ? "input-available"
            : "input-streaming";

    return {
      type: "tool-commandExecution",
      toolName: "commandExecution",
      toolCallId,
      state,
      input: {
        command: asString(input.command),
        cwd: asString(input.cwd),
        commandActions: asArray(input.commandActions),
      },
      output: {
        text: outputText.trimEnd(),
        exitCode,
        durationMs:
          typeof completed.durationMs === "number" ? completed.durationMs : undefined,
        status: resolvedStatus,
      },
      errorText:
        resolvedStatus === "failed"
          ? asString(completed.error || completed.message || "command_execution_failed")
          : undefined,
      metadata: {
        source: "codex.timeline",
        sequence: command.sequence ?? 0,
        at: command.at ?? "",
      },
    };
  });
}

export function buildCodexReplayAssistantEvent(params: {
  eventId: string;
  createdAt: string;
  chunks: Array<Record<string, unknown>>;
}) {
  const chunks = asArray<AnyRecord>(params.chunks);
  const messageParts = new Map<
    string,
    {
      itemId: string;
      sequence: number;
      at: string;
      text: string;
      order: number;
    }
  >();
  const messageOrder: string[] = [];
  const completedMessageIds = new Set<string>();
  const completedReasoningItems: Array<{
    sequence: number;
    at: string;
    itemId: string;
    text: string;
  }> = [];
  let reasoningText = "";
  let diff = "";
  let providerContextId = "";
  let turnId = "";
  let tokenUsage: Record<string, unknown> = {};
  let turnCompleted = false;
  let turnCompletedSequence = 0;
  let turnCompletedAt = "";

  const ensureMessagePart = (itemId: string, chunk: AnyRecord) => {
    const normalizedId = itemId || `agent-message:${messageOrder.length + 1}`;
    const existing = messageParts.get(normalizedId);
    if (existing) return existing;
    const next = {
      itemId: normalizedId,
      sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
      at: asString(chunk.at),
      text: "",
      order: messageOrder.length,
    };
    messageOrder.push(normalizedId);
    messageParts.set(normalizedId, next);
    return next;
  };

  for (const chunk of chunks) {
    const data = asRecord(chunk.data);
    const paramsRecord = asRecord(data.params);
    const item = asRecord(paramsRecord.item);
    const turn = asRecord(paramsRecord.turn);
    const method = asString(data.method);

    providerContextId =
      asString(paramsRecord.threadId) ||
      asString(paramsRecord.providerContextId) ||
      asString(turn.threadId) ||
      asString(turn.providerContextId) ||
      providerContextId;
    turnId = asString(paramsRecord.turnId) || asString(turn.id) || turnId;

    if (method === "item/started" && asString(item.type) === "agentMessage") {
      ensureMessagePart(asString(item.id), chunk);
      continue;
    }

    if (method === "item/agentMessage/delta") {
      const messagePart = ensureMessagePart(asString(paramsRecord.itemId), chunk);
      messagePart.text += asString(paramsRecord.delta);
      messagePart.sequence =
        typeof chunk.sequence === "number"
          ? Math.max(messagePart.sequence, chunk.sequence)
          : messagePart.sequence;
      messagePart.at = asString(chunk.at) || messagePart.at;
      continue;
    }

    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      reasoningText += asString(paramsRecord.delta);
      continue;
    }

    if (method === "turn/diff/updated") {
      diff = asString(paramsRecord.diff) || diff;
      continue;
    }

    if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") {
      tokenUsage = asRecord(paramsRecord.tokenUsage);
      continue;
    }

    if (method === "item/completed" && asString(item.type) === "agentMessage") {
      const messagePart = ensureMessagePart(asString(item.id), chunk);
      const completedText = asString(item.text);
      if (completedText) {
        messagePart.text = completedText;
      }
      messagePart.sequence =
        typeof chunk.sequence === "number"
          ? Math.max(messagePart.sequence, chunk.sequence)
          : messagePart.sequence;
      messagePart.at = asString(chunk.at) || messagePart.at;
      completedMessageIds.add(messagePart.itemId);
      continue;
    }

    if (method === "item/completed" && asString(item.type) === "reasoning") {
      const text = asString(item.summary || item.text).trim();
      if (!text) continue;
      completedReasoningItems.push({
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
        itemId: asString(item.id),
        text,
      });
      continue;
    }

    if (method === "turn/completed") {
      turnCompleted = true;
      turnCompletedSequence =
        typeof chunk.sequence === "number" ? chunk.sequence : turnCompletedSequence;
      turnCompletedAt = asString(chunk.at) || turnCompletedAt;
    }
  }

  const entries: Array<{ sequence: number; part: Record<string, unknown> }> = [];
  const sortedMessageParts = Array.from(messageParts.values()).sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.order - b.order;
  });

  for (const message of sortedMessageParts) {
    if (!message.text.trim()) continue;
    entries.push({
      sequence: message.sequence,
      part: {
        type: "text",
        text: message.text,
        metadata: {
          source: completedMessageIds.has(message.itemId)
            ? "codex.timeline"
            : "codex.timeline.live",
          sequence: message.sequence,
          at: message.at,
          itemId: message.itemId,
        },
      },
    });
  }

  if (reasoningText.trim()) {
    const lastReasoningChunk = [...chunks].reverse().find((chunk) => {
      const data = asRecord(chunk.data);
      const method = asString(data.method);
      return method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta";
    });
    entries.push({
      sequence:
        typeof lastReasoningChunk?.sequence === "number" ? lastReasoningChunk.sequence : 0,
      part: {
        type: "reasoning",
        text: reasoningText.trim(),
        metadata: {
          source: "codex.timeline.full",
          sequence:
            typeof lastReasoningChunk?.sequence === "number" ? lastReasoningChunk.sequence : 0,
          at: asString(lastReasoningChunk?.at),
        },
      },
    });
  } else {
    for (const reasoningItem of completedReasoningItems) {
      entries.push({
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
      });
    }
  }

  const streamTrace = {
    totalChunks: chunks.length,
    chunkTypes: countByChunkKey(chunks, "chunkType"),
    providerChunkTypes: countByChunkKey(chunks, "providerChunkType"),
    chunks,
  };
  const commandExecutions = getCommandExecutionPartsFromStreamTrace({
    chunks,
  });

  for (const commandExecution of commandExecutions) {
    const metadata = asRecord(commandExecution.metadata);
    entries.push({
      sequence:
        typeof metadata.sequence === "number" ? metadata.sequence : chunks.length + entries.length,
      part: commandExecution,
    });
  }

  entries.push({
    sequence: turnCompleted ? turnCompletedSequence : chunks.length + entries.length,
    part: {
      type: "tool-turnMetadata",
      toolName: "turnMetadata",
      toolCallId: turnId || providerContextId || params.eventId,
      state: turnCompleted ? "output-available" : "output-streaming",
      input: {},
      output: {
        providerContextId: providerContextId || null,
        turnId: turnId || null,
        diff,
        tokenUsage,
        streamTrace,
      },
      metadata: {
        source: "codex.stream.replay",
        sequence: turnCompleted ? turnCompletedSequence : chunks.length + entries.length,
        at: turnCompleted ? turnCompletedAt : "",
      },
    },
  });

  const parts = entries
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.part);
  const event = {
    id: params.eventId,
    type: "output",
    channel: "web",
    createdAt: params.createdAt,
    status: turnCompleted ? "completed" : "pending",
    content: {
      parts,
    },
  };
  const metadata = resolveTurnMetadata(event);

  return {
    event,
    metadata,
    streamTrace,
    trace: {
      events: chunks,
      chunks,
      summary: summarizeTrace({
        events: chunks,
        chunks,
        streamTrace,
      }),
    },
    commandExecutions,
    isCompleted: turnCompleted,
  };
}

export function resolveTurnMetadata(event: EventWithParts | null | undefined, llm?: unknown) {
  const metadataPart = findPartByType(event, "tool-turnMetadata");
  const partOutput = asRecord(asRecord(metadataPart).output);
  const llmMetadata = asRecord(asRecord(llm).rawProviderMetadata);
  const metadata = Object.keys(partOutput).length > 0 ? partOutput : llmMetadata;
  const tokenUsage = asRecord(metadata.tokenUsage);
  const streamTrace = asRecord(metadata.streamTrace);

  return {
    metadata,
    providerContextId: asString(metadata.providerContextId) || null,
    turnId: asString(metadata.turnId) || null,
    diff: asString(metadata.diff) || null,
    tokenUsage,
    streamTrace,
  };
}

export function extractUsageMetrics(usageSource: unknown) {
  const usage = asRecord(usageSource);
  const promptTokens =
    asFiniteNumber(usage.promptTokens) ??
    asFiniteNumber(usage.prompt_tokens) ??
    asFiniteNumber(usage.inputTokens) ??
    asFiniteNumber(usage.input_tokens) ??
    0;

  const completionTokens =
    asFiniteNumber(usage.completionTokens) ??
    asFiniteNumber(usage.completion_tokens) ??
    asFiniteNumber(usage.outputTokens) ??
    asFiniteNumber(usage.output_tokens) ??
    0;

  const totalTokens =
    asFiniteNumber(usage.totalTokens) ??
    asFiniteNumber(usage.total_tokens) ??
    promptTokens + completionTokens;

  const promptDetails = getNestedRecord(usage, "prompt_tokens_details");
  const inputDetails = getNestedRecord(usage, "input_tokens_details");
  const promptTokensCached =
    asFiniteNumber(usage.promptTokensCached) ??
    asFiniteNumber(usage.cached_prompt_tokens) ??
    asFiniteNumber(promptDetails.cached_tokens) ??
    asFiniteNumber(inputDetails.cached_tokens) ??
    0;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptTokensCached,
    promptTokensUncached: Math.max(0, promptTokens - promptTokensCached),
  };
}

export function deriveLlmFromAssistantEvent(params: {
  assistantEvent: EventWithParts | null | undefined;
  requestedModel?: string | null;
}) {
  const metadata = resolveTurnMetadata(params.assistantEvent);
  const usageMetrics = extractUsageMetrics(metadata.tokenUsage);

  return {
    provider: "codex",
    model: params.requestedModel || null,
    promptTokens: usageMetrics.promptTokens,
    promptTokensCached: usageMetrics.promptTokensCached,
    promptTokensUncached: usageMetrics.promptTokensUncached,
    completionTokens: usageMetrics.completionTokens,
    totalTokens: usageMetrics.totalTokens,
    rawUsage: metadata.tokenUsage,
    rawProviderMetadata: metadata.metadata,
  };
}

export function summarizeTrace(params: {
  events?: Array<Record<string, unknown>>;
  chunks?: Array<Record<string, unknown>>;
  streamTrace?: unknown;
}) {
  const events = Array.isArray(params.events) ? params.events : [];
  const chunks = Array.isArray(params.chunks) ? params.chunks : [];
  const streamTrace = asRecord(params.streamTrace);
  const chunkTypes =
    Object.keys(asRecord(streamTrace.chunkTypes)).length > 0
      ? normalizeCountMap(streamTrace.chunkTypes)
      : chunks.reduce<Record<string, number>>((acc, chunk) => {
          const key = asString(chunk.chunkType) || "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
  const providerChunkTypes =
    Object.keys(asRecord(streamTrace.providerChunkTypes)).length > 0
      ? normalizeCountMap(streamTrace.providerChunkTypes)
      : chunks.reduce<Record<string, number>>((acc, chunk) => {
          const key = asString(chunk.providerChunkType) || "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});

  return {
    eventCount: events.length,
    chunkCount: chunks.length,
    streamTraceTotalChunks:
      asFiniteNumber(streamTrace.totalChunks) ?? chunks.length,
    chunkTypes,
    providerChunkTypes,
  };
}

export function buildProviderPersistenceAudit(params: {
  assistantEvent: EventWithParts | null | undefined;
  chunks?: unknown;
  streamTrace: unknown;
  turnId?: string | null;
  rawProviderEvents?: unknown;
}) {
  const streamTrace = asRecord(params.streamTrace);
  const chunks =
    asArray<AnyRecord>(params.chunks).length > 0
      ? asArray<AnyRecord>(params.chunks)
      : asArray<AnyRecord>(streamTrace.chunks);
  const rawProviderEvents = asArray<AnyRecord>(params.rawProviderEvents);
  const providerOrder = chunks
    .map((chunk) => {
      const data = asRecord(chunk.data);
      const method = asString(data.method);
      const paramsRecord = asRecord(data.params);
      const item = asRecord(paramsRecord.item);
      const itemType = asString(item.type);
      const sequence = typeof chunk.sequence === "number" ? chunk.sequence : 0;

      if (method === "item/completed" && itemType === "agentMessage") {
        return {
          key: `text:${asString(item.id) || sequence}`,
          sequence,
          type: "text",
          itemId: asString(item.id) || null,
          preview: asString(item.text).slice(0, 120),
        };
      }

      if (method === "item/completed" && itemType === "reasoning") {
        return {
          key: `reasoning:${asString(item.id) || sequence}`,
          sequence,
          type: "reasoning",
          itemId: asString(item.id) || null,
          preview: asString(item.summary || item.text).slice(0, 120),
        };
      }

      if (method === "item/completed" && itemType === "commandExecution") {
        return {
          key: `command:${asString(item.id)}`,
          sequence,
          type: "tool-commandExecution",
          itemId: asString(item.id) || null,
          preview: asString(item.command).slice(0, 120),
        };
      }

      if (method === "turn/completed") {
        const turn = asRecord(paramsRecord.turn);
        const turnId = asString(turn.id || paramsRecord.turnId || params.turnId);
        return {
          key: `turn:${turnId}`,
          sequence,
          type: "tool-turnMetadata",
          itemId: turnId || null,
          preview: turnId,
        };
      }

      return null;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const persistedParts = readParts(params.assistantEvent);
  const persistedOrder = persistedParts
    .map((part, index) => {
      const type = asString(part.type);
      const metadata = asRecord(part.metadata);
      const output = asRecord(part.output);
      const sequence =
        typeof metadata.sequence === "number" ? metadata.sequence : index;

      if (type === "text") {
        const itemId = asString(metadata.itemId);
        return {
          key: `text:${itemId || sequence}`,
          sequence,
          type,
          itemId: itemId || null,
          preview: asString(part.text).slice(0, 120),
        };
      }

      if (type === "reasoning") {
        const itemId = asString(metadata.itemId);
        return {
          key: `reasoning:${itemId || sequence}`,
          sequence,
          type,
          itemId: itemId || null,
          preview: asString(part.text).slice(0, 120),
        };
      }

      if (type === "tool-commandExecution") {
        const toolCallId = asString(part.toolCallId);
        return {
          key: `command:${toolCallId}`,
          sequence,
          type,
          itemId: toolCallId || null,
          preview: asString(asRecord(part.input).command).slice(0, 120),
        };
      }

      if (type === "tool-turnMetadata") {
        const turnId = asString(output.turnId || part.toolCallId);
        return {
          key: `turn:${turnId}`,
          sequence,
          type,
          itemId: turnId || null,
          preview: turnId,
        };
      }

      return null;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const providerKeys = providerOrder.map((entry) => asString(entry.key));
  const persistedKeys = persistedOrder.map((entry) => asString(entry.key));
  const missingInPersisted = providerKeys.filter((key) => !persistedKeys.includes(key));
  const extraInPersisted = persistedKeys.filter((key) => !providerKeys.includes(key));
  const providerReasoningEvents = rawProviderEvents.filter((event) => {
    const method = asString(event.method);
    const item = asRecord(asRecord(event.params).item);
    return (
      method.includes("reasoning") ||
      (method === "item/completed" && asString(item.type) === "reasoning")
    );
  });
  const persistedReasoningParts = persistedParts.filter(
    (part) => asString(part.type) === "reasoning",
  );
  const providerTextEvents = rawProviderEvents.filter((event) => {
    const method = asString(event.method);
    const item = asRecord(asRecord(event.params).item);
    return (
      method === "item/agentMessage/delta" ||
      (method === "item/completed" && asString(item.type) === "agentMessage")
    );
  });
  const persistedTextParts = persistedParts.filter(
    (part) => asString(part.type) === "text",
  );

  return {
    orderMatches:
      providerKeys.length === persistedKeys.length &&
      providerKeys.every((key, index) => key === persistedKeys[index]),
    providerOrder,
    persistedOrder,
    rawProviderEvents,
    rawReactorChunks: chunks,
    rawPersistedParts: persistedParts,
    comparison: {
      providerEventCount: rawProviderEvents.length,
      reactorChunkCount: chunks.length,
      persistedPartCount: persistedParts.length,
      persistedCodexEventCount: 0,
      persistedRawProviderEventCount: 0,
      providerReasoningEventCount: providerReasoningEvents.length,
      persistedReasoningPartCount: persistedReasoningParts.length,
      providerTextEventCount: providerTextEvents.length,
      persistedTextPartCount: persistedTextParts.length,
      rawProviderStoredInParts: false,
      rawProviderMatchesPersistedRaw: null,
      missingInPersisted,
      extraInPersisted,
    },
  };
}
