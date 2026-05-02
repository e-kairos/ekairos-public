type ActionStatus = "started" | "completed" | "failed";

type CanonicalContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      mediaType: string;
      filename?: string;
      data?: string;
      url?: string;
      fileId?: string;
    }
  | {
      type: "json";
      value: unknown;
    }
  | {
      type: "source-url";
      sourceId: string;
      url: string;
      title?: string;
    }
  | {
      type: "source-document";
      sourceId: string;
      mediaType: string;
      title: string;
      filename?: string;
    };

export type ContextActionPartInfo = {
  actionName: string;
  actionCallId: string;
  status: ActionStatus;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function buildFileUrl(block: {
  mediaType: string;
  data?: string;
  url?: string;
  fileId?: string;
}) {
  if (typeof block.url === "string" && block.url.length > 0) {
    return block.url;
  }

  if (typeof block.data === "string" && block.data.length > 0) {
    return block.data.startsWith("data:")
      ? block.data
      : `data:${block.mediaType};base64,${block.data}`;
  }

  if (typeof block.fileId === "string" && block.fileId.length > 0) {
    return block.fileId;
  }

  return "";
}

function readTextPayload(value: unknown): string {
  const record = asRecord(value);
  if (!record) return asText(value);

  return (
    asText(record.text) ||
    asText(record.message) ||
    asText(record.summary) ||
    asText(asRecord(record.content)?.text) ||
    asText(asRecord(record.content)?.message)
  );
}

function normalizeContentBlock(value: unknown): CanonicalContentBlock | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== "string") return null;

  if (record.type === "text") {
    const text = asText(record.text);
    return text ? { type: "text", text } : null;
  }

  if (record.type === "file") {
    const mediaType = asText(record.mediaType) || "application/octet-stream";
    const file = cleanRecord({
      type: "file" as const,
      mediaType,
      filename: asText(record.filename) || undefined,
      data: asText(record.data) || undefined,
      url: buildFileUrl({
        mediaType,
        data: asText(record.data) || undefined,
        url: asText(record.url) || undefined,
        fileId: asText(record.fileId) || undefined,
      }) || undefined,
      fileId: asText(record.fileId) || undefined,
    });
    return file.url || file.data || file.fileId ? file : null;
  }

  if (record.type === "json") {
    return { type: "json", value: record.value };
  }

  if (record.type === "source-url") {
    const url = asText(record.url);
    if (!url) return null;
    return cleanRecord({
      type: "source-url" as const,
      sourceId: asText(record.sourceId) || "source-url",
      url,
      title: asText(record.title) || undefined,
    });
  }

  if (record.type === "source-document") {
    return cleanRecord({
      type: "source-document" as const,
      sourceId: asText(record.sourceId) || "source-document",
      mediaType: asText(record.mediaType) || "application/octet-stream",
      title: asText(record.title) || "Document",
      filename: asText(record.filename) || undefined,
    });
  }

  return null;
}

function normalizeBlocks(value: unknown): CanonicalContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((block) => normalizeContentBlock(block))
    .filter((block): block is CanonicalContentBlock => Boolean(block));
}

function blocksToMessageContent(blocks: CanonicalContentBlock[]) {
  const text = blocks
    .filter((block): block is Extract<CanonicalContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  const hasNonText = blocks.some((block) => block.type !== "text");

  return cleanRecord({
    text: text || undefined,
    blocks: hasNonText ? blocks : undefined,
  });
}

function blocksToValue(blocks: CanonicalContentBlock[]) {
  if (blocks.length === 0) return undefined;
  if (blocks.length === 1) {
    const first = blocks[0];
    if (first.type === "json") return first.value;
    if (first.type === "text") return first.text;
    if (first.type === "file") return first;
  }

  return {
    type: "content",
    value: blocks,
  };
}

function blocksToErrorText(blocks: CanonicalContentBlock[]) {
  const text = blocks
    .filter((block): block is Extract<CanonicalContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();

  if (text) return text;

  const jsonBlock = blocks.find((block) => block.type === "json");
  if (jsonBlock) {
    return JSON.stringify(jsonBlock.value, null, 2);
  }

  return "";
}

function normalizeMessagePart(part: Record<string, unknown>) {
  const content = asRecord(part.content) ?? {};
  const rawBlocks = Array.isArray(content.blocks)
    ? content.blocks
    : Array.isArray(part.content)
      ? part.content
      : [];
  const blocks = normalizeBlocks(rawBlocks);
  const text = readTextPayload(content) || readTextPayload(part);

  if (text) {
    blocks.unshift({ type: "text", text });
  }

  const messageContent = blocksToMessageContent(blocks);
  return Object.keys(messageContent).length > 0
    ? [{ type: "message", content: messageContent }]
    : [];
}

function normalizeReasoningPart(part: Record<string, unknown>) {
  const content = part.content;
  const contentRecord = asRecord(content);
  const text = Array.isArray(content)
    ? normalizeBlocks(content)
        .filter((block): block is Extract<CanonicalContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n\n")
    : readTextPayload(contentRecord) || asText(part.text);

  const state =
    asText(contentRecord?.state) ||
    asText(part.state) ||
    undefined;

  return text || state
    ? [
        {
          type: "reasoning",
          content: cleanRecord({
            text,
            state,
          }),
        },
      ]
    : [];
}

function normalizeSourcePart(part: Record<string, unknown>) {
  const content = part.content;
  const rawSources = Array.isArray(content)
    ? content
    : Array.isArray(asRecord(content)?.sources)
      ? (asRecord(content)?.sources as unknown[])
      : [];
  const sources = normalizeBlocks(rawSources).filter(
    (block): block is Extract<CanonicalContentBlock, { type: "source-url" | "source-document" }> =>
      block.type === "source-url" || block.type === "source-document",
  );

  return sources.length > 0
    ? [
        {
          type: "source",
          content: { sources },
        },
      ]
    : [];
}

function normalizeActionStatus(value: unknown, fallback?: unknown): ActionStatus {
  const status = (asText(value) || asText(fallback)).toLowerCase();
  if (status === "failed" || status === "error" || status === "output-error") {
    return "failed";
  }
  if (
    status === "completed" ||
    status === "complete" ||
    status === "output-available"
  ) {
    return "completed";
  }
  return "started";
}

function normalizeActionPart(part: Record<string, unknown>) {
  const content = asRecord(part.content) ?? {};
  const actionName =
    asText(content.actionName) ||
    asText(content.toolName) ||
    asText(part.actionName) ||
    asText(part.toolName);

  if (!actionName) return [];

  const output = content.output ?? part.output;
  const error = content.error ?? content.errorText ?? part.error ?? part.errorText;
  const status = normalizeActionStatus(
    content.status ?? part.status,
    error !== undefined ? "failed" : output !== undefined ? "completed" : "started",
  );
  const actionCallId =
    asText(content.actionCallId) ||
    asText(content.toolCallId) ||
    asText(content.actionRef) ||
    asText(part.actionCallId) ||
    asText(part.toolCallId) ||
    asText(part.actionRef) ||
    actionName;

  if (status === "failed") {
    return [
      {
        type: "action",
        content: {
          status,
          actionName,
          actionCallId,
          error: {
            message: readTextPayload(error) || "Action failed.",
          },
        },
      },
    ];
  }

  if (status === "completed") {
    return [
      {
        type: "action",
        content: {
          status,
          actionName,
          actionCallId,
          output,
        },
      },
    ];
  }

  return [
    {
      type: "action",
      content: {
        status,
        actionName,
        actionCallId,
        input: content.input ?? part.input,
      },
    },
  ];
}

function normalizeLegacyToolPart(part: Record<string, unknown>) {
  const type = asText(part.type);
  if (!type.startsWith("tool-")) return [];

  const actionName = type.slice("tool-".length);
  const actionCallId = asText(part.toolCallId) || asText(part.actionCallId) || actionName;
  const state = asText(part.state).toLowerCase();
  const input = part.input ?? part.args;
  const parts: Record<string, unknown>[] = [
    {
      type: "action",
      content: {
        status: "started",
        actionName,
        actionCallId,
        input,
      },
    },
  ];

  if (state === "output-error") {
    parts.push({
      type: "action",
      content: {
        status: "failed",
        actionName,
        actionCallId,
        error: {
          message: readTextPayload(part.errorText ?? part.error) || "Action failed.",
        },
      },
    });
  } else if (state === "output-available") {
    parts.push({
      type: "action",
      content: {
        status: "completed",
        actionName,
        actionCallId,
        output: part.output,
      },
    });
  }

  return parts;
}

function normalizeLegacyToolCallPart(part: Record<string, unknown>) {
  const toolName = asText(part.toolName);
  const toolCallId = asText(part.toolCallId);
  if (!toolName || !toolCallId) return [];

  const content = normalizeBlocks(part.content);
  return [
    {
      type: "action",
      content: {
        status: "started",
        actionName: toolName,
        actionCallId: toolCallId,
        input: blocksToValue(content),
      },
    },
  ];
}

function normalizeLegacyToolResultPart(part: Record<string, unknown>) {
  const toolName = asText(part.toolName);
  const toolCallId = asText(part.toolCallId);
  if (!toolName || !toolCallId) return [];

  const content = normalizeBlocks(part.content);
  const state = asText(part.state).toLowerCase();
  const failed = state === "output-error";

  return [
    failed
      ? {
          type: "action",
          content: {
            status: "failed",
            actionName: toolName,
            actionCallId: toolCallId,
            error: {
              message: blocksToErrorText(content) || "Action failed.",
            },
          },
        }
      : {
          type: "action",
          content: {
            status: "completed",
            actionName: toolName,
            actionCallId: toolCallId,
            output: blocksToValue(content),
          },
        },
  ];
}

function normalizePart(part: unknown): Record<string, unknown>[] {
  const record = asRecord(part);
  if (!record || typeof record.type !== "string") {
    return record ? [record] : [];
  }

  if (record.type === "text" || record.type === "file") {
    return [record];
  }

  if (record.type === "source-url" || record.type === "source-document") {
    const source = normalizeContentBlock(record);
    return source ? [source] : [];
  }

  if (record.type === "content") {
    const blocks = normalizeBlocks(record.content);
    const content = blocksToMessageContent(blocks);
    return Object.keys(content).length > 0
      ? [{ type: "message", content }]
      : [];
  }

  if (record.type === "message") {
    return normalizeMessagePart(record);
  }

  if (record.type === "reasoning") {
    return normalizeReasoningPart(record);
  }

  if (record.type === "source") {
    return normalizeSourcePart(record);
  }

  if (record.type === "action" || record.type === "action_result") {
    return normalizeActionPart(record);
  }

  if (record.type === "tool-call") {
    return normalizeLegacyToolCallPart(record);
  }

  if (record.type === "tool-result") {
    return normalizeLegacyToolResultPart(record);
  }

  if (record.type.startsWith("tool-")) {
    return normalizeLegacyToolPart(record);
  }

  if (record.type.startsWith("data-")) {
    return [
      {
        type: "message",
        content: {
          blocks: [{ type: "json", value: record.data }],
        },
      },
    ];
  }

  return [record];
}

export function normalizeContextEventParts(parts: unknown[]) {
  return (Array.isArray(parts) ? parts : []).flatMap(normalizePart);
}

export function getActionPartInfo(part: unknown): ContextActionPartInfo | null {
  const record = asRecord(part);
  if (!record) return null;

  if (typeof record.type === "string" && record.type.startsWith("tool-")) {
    const actionName = record.type.slice("tool-".length);
    const status = normalizeActionStatus(record.state);
    return {
      actionName,
      actionCallId: asText(record.toolCallId) || asText(record.actionCallId) || actionName,
      status,
      input: record.input ?? record.args,
      output: record.output,
      errorText: readTextPayload(record.errorText ?? record.error),
    };
  }

  if (record.type !== "action" && record.type !== "action_result") {
    return null;
  }

  const content = asRecord(record.content) ?? {};
  const actionName =
    asText(content.actionName) ||
    asText(content.toolName) ||
    asText(record.actionName) ||
    asText(record.toolName);
  if (!actionName) return null;

  const output = content.output ?? record.output;
  const error = content.error ?? content.errorText ?? record.error ?? record.errorText;
  const status = normalizeActionStatus(
    content.status ?? record.status,
    error !== undefined ? "failed" : output !== undefined ? "completed" : "started",
  );

  return {
    actionName,
    actionCallId:
      asText(content.actionCallId) ||
      asText(content.toolCallId) ||
      asText(content.actionRef) ||
      asText(record.actionCallId) ||
      asText(record.toolCallId) ||
      asText(record.actionRef) ||
      actionName,
    status,
    input: content.input ?? record.input,
    output,
    errorText: readTextPayload(error),
  };
}

export function getCreateMessageText(part: unknown): string {
  const action = getActionPartInfo(part);
  if (!action || action.actionName !== "createMessage") return "";

  if (action.status === "completed") {
    return readTextPayload(action.output) || readTextPayload(action.input);
  }

  return readTextPayload(action.input) || readTextPayload(action.output);
}

export function getPartText(part: unknown): string {
  const record = asRecord(part);
  if (!record) return "";
  if (record.type === "text") return asText(record.text);
  if (record.type === "message") return readTextPayload(record.content) || readTextPayload(record);
  return "";
}

export function getReasoningText(part: unknown): string {
  const record = asRecord(part);
  if (!record || record.type !== "reasoning") return "";
  return readTextPayload(record.content) || asText(record.text);
}

export function getReasoningState(part: unknown): string {
  const record = asRecord(part);
  if (!record || record.type !== "reasoning") return "";
  return asText(asRecord(record.content)?.state) || asText(record.state);
}

export function getSourceParts(part: unknown) {
  const record = asRecord(part);
  if (!record) return [];

  if (record.type === "source-url" || record.type === "source-document") {
    return [record];
  }

  if (record.type !== "source") return [];
  const sources = asRecord(record.content)?.sources;
  return Array.isArray(sources)
    ? sources.filter((source) => asRecord(source))
    : [];
}

export function findNormalizedToolPart(parts: unknown[], toolName: string) {
  const normalized = normalizeContextEventParts(parts);
  return (
    normalized.find((part) => {
      const action = getActionPartInfo(part);
      return action?.actionName === toolName;
    }) ?? null
  );
}
