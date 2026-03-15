type AnyRecord = Record<string, unknown>;

type EventWithParts = {
  content?: {
    parts?: unknown[];
  };
};

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

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
        });
      }
      continue;
    }
    if (method === "item/commandExecution/outputDelta") {
      const itemId = asString(paramsRecord.itemId);
      if (!itemId) continue;
      const current = commands.get(itemId) ?? {};
      current.outputText = `${current.outputText ?? ""}${asString(paramsRecord.delta)}`;
      commands.set(itemId, current);
      continue;
    }
    if (method === "item/completed") {
      const item = asRecord(paramsRecord.item);
      if (asString(item.type) === "commandExecution") {
        const itemId = asString(item.id);
        const current = commands.get(itemId) ?? {};
        current.completed = item;
        commands.set(itemId, current);
      }
    }
  }

  return Array.from(commands.entries()).map(([toolCallId, command]) => {
    const input = asRecord(command.input);
    const completed = asRecord(command.completed);
    const outputText = asString(completed.aggregatedOutput || command.outputText).trim();
    const status = asString(completed.status || input.status || "completed").trim();
    const exitCode =
      typeof completed.exitCode === "number" ? completed.exitCode : undefined;

    return {
      type: "tool-commandExecution",
      toolName: "commandExecution",
      toolCallId,
      state:
        status === "failed" || (typeof exitCode === "number" && exitCode !== 0)
          ? "output-error"
          : "output-available",
      input: {
        command: asString(input.command),
        cwd: asString(input.cwd),
        commandActions: asArray(input.commandActions),
      },
      output: {
        text: outputText,
        exitCode,
        durationMs:
          typeof completed.durationMs === "number" ? completed.durationMs : undefined,
        status,
      },
      errorText:
        status === "failed"
          ? asString(completed.error || completed.message || "command_execution_failed")
          : undefined,
    };
  });
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
  streamTrace: unknown;
  turnId?: string | null;
}) {
  const streamTrace = asRecord(params.streamTrace);
  const chunks = asArray<AnyRecord>(streamTrace.chunks);
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

  return {
    orderMatches:
      providerKeys.length === persistedKeys.length &&
      providerKeys.every((key, index) => key === persistedKeys[index]),
    providerOrder,
    persistedOrder,
  };
}
