import { z } from "zod"

const metadataSchema = z.record(z.string(), z.unknown()).optional()

const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const fileContentSchema = z
  .object({
    type: z.literal("file"),
    mediaType: z.string().min(1),
    filename: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
    fileId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.data && !value.url && !value.fileId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "file content requires one of data, url, or fileId",
      })
    }
  })

const jsonContentSchema = z.object({
  type: z.literal("json"),
  value: z.unknown(),
})

const sourceUrlContentSchema = z.object({
  type: z.literal("source-url"),
  sourceId: z.string(),
  url: z.string().min(1),
  title: z.string().optional(),
})

const sourceDocumentContentSchema = z.object({
  type: z.literal("source-document"),
  sourceId: z.string(),
  mediaType: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().optional(),
})

export const contextPartContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  fileContentSchema,
  jsonContentSchema,
  sourceUrlContentSchema,
  sourceDocumentContentSchema,
])

const contextInlineContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  fileContentSchema,
  jsonContentSchema,
])

const contextContentPartSchema = z.object({
  type: z.literal("content"),
  content: z.array(contextInlineContentSchema),
  state: z.enum(["streaming", "done"]).optional(),
})

const contextReasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  content: z.array(textContentSchema),
  state: z.enum(["streaming", "done"]).optional(),
})

const contextSourcePartSchema = z.object({
  type: z.literal("source"),
  content: z.array(
    z.discriminatedUnion("type", [sourceUrlContentSchema, sourceDocumentContentSchema]),
  ),
})

const contextToolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  content: z.array(contextInlineContentSchema),
  state: z.enum(["input-streaming", "input-available"]).optional(),
})

const contextToolResultPartSchema = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  content: z.array(contextInlineContentSchema),
  state: z.enum(["output-available", "output-error"]).optional(),
})

export const contextPartSchema = z.discriminatedUnion("type", [
  contextContentPartSchema,
  contextReasoningPartSchema,
  contextSourcePartSchema,
  contextToolCallPartSchema,
  contextToolResultPartSchema,
])

export const contextPartEnvelopeSchema = z.discriminatedUnion("type", [
  contextContentPartSchema.extend({
    metadata: metadataSchema,
  }),
  contextReasoningPartSchema.extend({
    metadata: metadataSchema,
  }),
  contextSourcePartSchema.extend({
    metadata: metadataSchema,
  }),
  contextToolCallPartSchema.extend({
    metadata: metadataSchema,
  }),
  contextToolResultPartSchema.extend({
    metadata: metadataSchema,
  }),
])

export type ContextPartContent = z.infer<typeof contextPartContentSchema>
export type ContextInlineContent = z.infer<typeof contextInlineContentSchema>
export type ContextPart = z.infer<typeof contextPartSchema>
export type ContextPartEnvelope = z.infer<typeof contextPartEnvelopeSchema>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function cleanRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

export function isContextPartEnvelope(value: unknown): value is ContextPartEnvelope {
  return contextPartEnvelopeSchema.safeParse(value).success
}

export function parseContextPartEnvelope(value: unknown): ContextPartEnvelope {
  return contextPartEnvelopeSchema.parse(value)
}

export function splitContextPartEnvelope(value: ContextPartEnvelope): {
  part: ContextPart
  metadata?: Record<string, unknown>
} {
  const { metadata, ...part } = value
  return {
    part,
    metadata,
  }
}

export function mergeContextPartEnvelope(params: {
  part: unknown
  metadata?: unknown
}): ContextPartEnvelope {
  return parseContextPartEnvelope({
    ...(asRecord(params.part) ?? {}),
    metadata: normalizeMetadata(params.metadata),
  })
}

function normalizeFileContentBlock(value: Record<string, unknown>): ContextInlineContent {
  return contextInlineContentSchema.parse(
    cleanRecord({
      type: "file",
      mediaType: typeof value.mediaType === "string" ? value.mediaType : "application/octet-stream",
      filename: typeof value.filename === "string" ? value.filename : undefined,
      data: typeof value.data === "string" ? value.data : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      fileId: typeof value.fileId === "string" ? value.fileId : undefined,
    }),
  )
}

export function normalizeToolResultContentToBlocks(value: unknown): ContextInlineContent[] {
  if (value === undefined || value === null) {
    return []
  }

  if (typeof value === "string") {
    return [{ type: "text", text: value }]
  }

  const record = asRecord(value)
  if (!record) {
    return [{ type: "json", value }]
  }

  if (record.type === "json") {
    return [{ type: "json", value: record.value }]
  }

  if (record.type === "content" && Array.isArray(record.value)) {
    const blocks: ContextInlineContent[] = []
    for (const entry of record.value) {
      const contentRecord = asRecord(entry)
      if (!contentRecord || typeof contentRecord.type !== "string") {
        blocks.push({ type: "json", value: entry })
        continue
      }

      if (contentRecord.type === "text" && typeof contentRecord.text === "string") {
        blocks.push({ type: "text", text: contentRecord.text })
        continue
      }

      if (contentRecord.type === "image-data") {
        blocks.push(
          cleanRecord({
            type: "file" as const,
            mediaType:
              typeof contentRecord.mediaType === "string"
                ? contentRecord.mediaType
                : "application/octet-stream",
            filename:
              typeof contentRecord.filename === "string"
                ? contentRecord.filename
                : undefined,
            data:
              typeof contentRecord.data === "string" ? contentRecord.data : undefined,
          }),
        )
        continue
      }

      if (contentRecord.type === "file") {
        blocks.push(normalizeFileContentBlock(contentRecord))
        continue
      }

      blocks.push({ type: "json", value: entry })
    }
    return blocks
  }

  if (record.type === "file") {
    return [normalizeFileContentBlock(record)]
  }

  return [{ type: "json", value }]
}

function metadataFromUiPart(part: Record<string, unknown>) {
  const metadata = cleanRecord({
    provider: normalizeMetadata(part.providerMetadata),
    providerCall: normalizeMetadata(part.callProviderMetadata),
  })

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function normalizeUiPartToContextPartEnvelopes(value: unknown): ContextPartEnvelope[] {
  const record = asRecord(value)
  if (!record || typeof record.type !== "string") {
    return []
  }

  const metadata = metadataFromUiPart(record)

  if (record.type === "text" && typeof record.text === "string") {
    return [
      {
        type: "content",
        content: [{ type: "text", text: record.text }],
        state: record.state === "streaming" ? "streaming" : "done",
        metadata,
      },
    ]
  }

  if (record.type === "reasoning" && typeof record.text === "string") {
    return [
      {
        type: "reasoning",
        content: [{ type: "text", text: record.text }],
        state: record.state === "streaming" ? "streaming" : "done",
        metadata,
      },
    ]
  }

  if (record.type === "file") {
    return [
      {
        type: "content",
        content: [
          cleanRecord({
            type: "file" as const,
            mediaType:
              typeof record.mediaType === "string"
                ? record.mediaType
                : "application/octet-stream",
            filename: typeof record.filename === "string" ? record.filename : undefined,
            url: typeof record.url === "string" ? record.url : undefined,
            data: typeof record.data === "string" ? record.data : undefined,
            fileId: typeof record.fileId === "string" ? record.fileId : undefined,
          }),
        ],
        metadata,
      },
    ]
  }

  if (record.type === "source-url") {
    return [
      {
        type: "source",
        content: [
          {
            type: "source-url",
            sourceId:
              typeof record.sourceId === "string" ? record.sourceId : "source-url",
            url: typeof record.url === "string" ? record.url : "",
            title: typeof record.title === "string" ? record.title : undefined,
          },
        ],
        metadata,
      },
    ]
  }

  if (record.type === "source-document") {
    return [
      {
        type: "source",
        content: [
          {
            type: "source-document",
            sourceId:
              typeof record.sourceId === "string"
                ? record.sourceId
                : "source-document",
            mediaType:
              typeof record.mediaType === "string"
                ? record.mediaType
                : "application/octet-stream",
            title: typeof record.title === "string" ? record.title : "Document",
            filename: typeof record.filename === "string" ? record.filename : undefined,
          },
        ],
        metadata,
      },
    ]
  }

  if (record.type.startsWith("data-")) {
    return [
      {
        type: "content",
        content: [
          {
            type: "json",
            value: record.data,
          },
        ],
        metadata: cleanRecord({
          ...(metadata ?? {}),
          app: {
            dataPartType: record.type.slice("data-".length),
          },
        }),
      },
    ]
  }

  if (record.type.startsWith("tool-")) {
    const toolName = record.type.slice("tool-".length)
    const toolCallId =
      typeof record.toolCallId === "string" ? record.toolCallId : ""
    if (!toolName || !toolCallId) {
      return []
    }

    const callPart: ContextPartEnvelope = {
      type: "tool-call",
      toolCallId,
      toolName,
      state:
        record.state === "input-streaming"
          ? "input-streaming"
          : "input-available",
      content:
        "input" in record && record.input !== undefined
          ? [{ type: "json", value: record.input }]
          : [],
      metadata,
    }

    if (record.state === "output-available" || record.state === "output-error") {
      return [
        callPart,
        {
          type: "tool-result",
          toolCallId,
          toolName,
          state: record.state,
          content:
            record.state === "output-error"
              ? [
                  {
                    type: "text",
                    text:
                      typeof record.errorText === "string" && record.errorText.length > 0
                        ? record.errorText
                        : "Tool execution failed.",
                  },
                ]
              : normalizeToolResultContentToBlocks(record.output),
          metadata,
        },
      ]
    }

    return [callPart]
  }

  return []
}

export function normalizePartsForPersistence(parts: unknown[]): ContextPartEnvelope[] {
  const normalized = parts.flatMap((part) => {
    if (isContextPartEnvelope(part)) {
      return [parseContextPartEnvelope(part)]
    }
    return normalizeUiPartToContextPartEnvelopes(part)
  })

  return normalized
}
