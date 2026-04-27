import { z } from "zod"

export const reactorMetadataSchema = z
  .object({
    reactorKind: z.string().min(1),
    executionId: z.string().optional(),
    itemId: z.string().optional(),
    eventName: z.string().optional(),
    actionCallId: z.string().optional(),
  })
  .catchall(z.unknown())

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

export const contextInlineContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  fileContentSchema,
  jsonContentSchema,
])

const messageContentSchema = z
  .object({
    text: z.string().optional(),
    blocks: z.array(contextInlineContentSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const hasText = typeof value.text === "string" && value.text.length > 0
    const hasBlocks = Array.isArray(value.blocks) && value.blocks.length > 0
    if (!hasText && !hasBlocks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message content requires text or blocks",
      })
    }
  })

export const contextMessagePartSchema = z.object({
  type: z.literal("message"),
  content: messageContentSchema,
  reactorMetadata: reactorMetadataSchema.optional(),
})

export const contextReasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  content: z.object({
    text: z.string(),
    state: z.enum(["streaming", "done"]).optional(),
  }),
  reactorMetadata: reactorMetadataSchema.optional(),
})

export const contextSourcePartSchema = z.object({
  type: z.literal("source"),
  content: z.object({
    sources: z.array(
      z.discriminatedUnion("type", [sourceUrlContentSchema, sourceDocumentContentSchema]),
    ),
  }),
  reactorMetadata: reactorMetadataSchema.optional(),
})

const contextActionErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
})

export const contextActionPartSchema = z.object({
  type: z.literal("action"),
  content: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("started"),
      actionName: z.string().min(1),
      actionCallId: z.string().min(1),
      input: z.unknown(),
    }),
    z.object({
      status: z.literal("completed"),
      actionName: z.string().min(1),
      actionCallId: z.string().min(1),
      output: z.unknown(),
    }),
    z.object({
      status: z.literal("failed"),
      actionName: z.string().min(1),
      actionCallId: z.string().min(1),
      error: contextActionErrorSchema,
    }),
  ]),
  reactorMetadata: reactorMetadataSchema.optional(),
})

export const contextEnginePartSchema = z.discriminatedUnion("type", [
  contextMessagePartSchema,
  contextReasoningPartSchema,
  contextSourcePartSchema,
])

export const contextPartSchema = z.discriminatedUnion("type", [
  contextMessagePartSchema,
  contextReasoningPartSchema,
  contextSourcePartSchema,
  contextActionPartSchema,
])

export const contextPartEnvelopeSchema = contextPartSchema

export type ContextPartContent = z.infer<typeof contextPartContentSchema>
export type ContextInlineContent = z.infer<typeof contextInlineContentSchema>
export type ReactorMetadata = z.infer<typeof reactorMetadataSchema>
export type ContextEnginePart = z.infer<typeof contextEnginePartSchema>
export type ContextPartEnvelope = z.infer<typeof contextPartEnvelopeSchema>

export type ContextPartActionMap = Record<
  string,
  {
    input: z.ZodType
    output: z.ZodType
  }
>

type ContextActionName<TActions extends ContextPartActionMap> = Extract<
  keyof TActions,
  string
>

type ContextPartActionInput<TActions extends ContextPartActionMap, Name extends string> =
  Name extends keyof TActions ? z.output<TActions[Name]["input"]> : never

type ContextPartActionOutput<TActions extends ContextPartActionMap, Name extends string> =
  Name extends keyof TActions ? z.output<TActions[Name]["output"]> : never

export type ContextActionStartedPart<
  TActions extends ContextPartActionMap,
  Name extends ContextActionName<TActions> = ContextActionName<TActions>,
> = {
  type: "action"
  content: {
    status: "started"
    actionName: Name
    actionCallId: string
    input: ContextPartActionInput<TActions, Name>
  }
  reactorMetadata?: ReactorMetadata
}

export type ContextActionCompletedPart<
  TActions extends ContextPartActionMap,
  Name extends ContextActionName<TActions> = ContextActionName<TActions>,
> = {
  type: "action"
  content: {
    status: "completed"
    actionName: Name
    actionCallId: string
    output: ContextPartActionOutput<TActions, Name>
  }
  reactorMetadata?: ReactorMetadata
}

export type ContextActionFailedPart<
  TActions extends ContextPartActionMap,
  Name extends ContextActionName<TActions> = ContextActionName<TActions>,
> = {
  type: "action"
  content: {
    status: "failed"
    actionName: Name
    actionCallId: string
    error: {
      message: string
      code?: string
      details?: unknown
    }
  }
  reactorMetadata?: ReactorMetadata
}

export type ContextActionPart<TActions extends ContextPartActionMap> = {
  [Name in ContextActionName<TActions>]:
    | ContextActionStartedPart<TActions, Name>
    | ContextActionCompletedPart<TActions, Name>
    | ContextActionFailedPart<TActions, Name>
}[ContextActionName<TActions>]

export type ContextPart<
  TActions extends ContextPartActionMap = ContextPartActionMap,
> = ContextEnginePart | ContextActionPart<TActions>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function cleanRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function createContextActionPartSchemas<TActions extends ContextPartActionMap>(
  actions: TActions,
) {
  const schemas: z.ZodType[] = []
  for (const [actionName, action] of Object.entries(actions)) {
    schemas.push(
      z.object({
        type: z.literal("action"),
        content: z.object({
          status: z.literal("started"),
          actionName: z.literal(actionName),
          actionCallId: z.string().min(1),
          input: action.input,
        }),
        reactorMetadata: reactorMetadataSchema.optional(),
      }),
      z.object({
        type: z.literal("action"),
        content: z.object({
          status: z.literal("completed"),
          actionName: z.literal(actionName),
          actionCallId: z.string().min(1),
          output: action.output,
        }),
        reactorMetadata: reactorMetadataSchema.optional(),
      }),
      z.object({
        type: z.literal("action"),
        content: z.object({
          status: z.literal("failed"),
          actionName: z.literal(actionName),
          actionCallId: z.string().min(1),
          error: contextActionErrorSchema,
        }),
        reactorMetadata: reactorMetadataSchema.optional(),
      }),
    )
  }
  return schemas
}

export function createContextPartSchema<
  TActions extends ContextPartActionMap = Record<string, never>,
>(actions?: TActions): z.ZodType<ContextPart<TActions>> {
  const actionSchemas = actions ? createContextActionPartSchemas(actions) : []
  if (actionSchemas.length === 0) {
    return contextEnginePartSchema as unknown as z.ZodType<ContextPart<TActions>>
  }

  return z.union([
    contextMessagePartSchema,
    contextReasoningPartSchema,
    contextSourcePartSchema,
    ...actionSchemas,
  ] as [z.ZodType, z.ZodType, ...z.ZodType[]]) as unknown as z.ZodType<
    ContextPart<TActions>
  >
}

export function parseContextPart<TActions extends ContextPartActionMap>(
  actions: TActions,
  value: unknown,
): ContextPart<TActions> {
  return createContextPartSchema(actions).parse(value)
}

export function isContextPartEnvelope(value: unknown): value is ContextPartEnvelope {
  return contextPartEnvelopeSchema.safeParse(value).success
}

export function parseContextPartEnvelope(value: unknown): ContextPartEnvelope {
  return contextPartEnvelopeSchema.parse(value)
}

export function splitContextPartEnvelope(value: ContextPartEnvelope): {
  part: ContextPartEnvelope
  metadata?: undefined
} {
  return {
    part: parseContextPartEnvelope(value),
    metadata: undefined,
  }
}

export function mergeContextPartEnvelope(params: {
  part: unknown
  metadata?: unknown
}): ContextPartEnvelope {
  return parseContextPartEnvelope(params.part)
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

function readReactorMetadata(record: Record<string, unknown>) {
  const parsed = reactorMetadataSchema.safeParse(record.reactorMetadata)
  return parsed.success ? parsed.data : undefined
}

function messageFromBlocks(
  blocks: ContextInlineContent[],
  reactorMetadata?: ReactorMetadata,
): ContextPartEnvelope[] {
  if (blocks.length === 0) return []
  const text = blocks
    .filter((block): block is Extract<ContextInlineContent, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
  const hasNonText = blocks.some((block) => block.type !== "text")

  return [
    contextMessagePartSchema.parse(
      cleanRecord({
        type: "message" as const,
        content: cleanRecord({
          text: text || undefined,
          blocks: hasNonText ? blocks : undefined,
        }),
        reactorMetadata,
      }),
    ),
  ]
}

export function normalizeUiPartToContextPartEnvelopes(value: unknown): ContextPartEnvelope[] {
  const record = asRecord(value)
  if (!record || typeof record.type !== "string") {
    return []
  }

  const reactorMetadata = readReactorMetadata(record)

  if (record.type === "text" && typeof record.text === "string") {
    return messageFromBlocks([{ type: "text", text: record.text }], reactorMetadata)
  }

  if (record.type === "reasoning" && typeof record.text === "string") {
    return [
      contextReasoningPartSchema.parse(
        cleanRecord({
          type: "reasoning" as const,
          content: cleanRecord({
            text: record.text,
            state: record.state === "streaming" ? "streaming" : "done",
          }),
          reactorMetadata,
        }),
      ),
    ]
  }

  if (record.type === "file") {
    return messageFromBlocks([normalizeFileContentBlock(record)], reactorMetadata)
  }

  if (record.type === "source-url") {
    return [
      contextSourcePartSchema.parse(
        cleanRecord({
          type: "source" as const,
          content: {
            sources: [
              cleanRecord({
                type: "source-url" as const,
                sourceId:
                  typeof record.sourceId === "string" ? record.sourceId : "source-url",
                url: typeof record.url === "string" ? record.url : "",
                title: typeof record.title === "string" ? record.title : undefined,
              }),
            ],
          },
          reactorMetadata,
        }),
      ),
    ]
  }

  if (record.type === "source-document") {
    return [
      contextSourcePartSchema.parse(
        cleanRecord({
          type: "source" as const,
          content: {
            sources: [
              cleanRecord({
                type: "source-document" as const,
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
              }),
            ],
          },
          reactorMetadata,
        }),
      ),
    ]
  }

  if (record.type.startsWith("data-")) {
    return messageFromBlocks([{ type: "json", value: record.data }], reactorMetadata)
  }

  if (record.type.startsWith("tool-")) {
    const actionName = record.type.slice("tool-".length)
    const actionCallId =
      typeof record.toolCallId === "string" ? record.toolCallId : ""
    if (!actionName || !actionCallId) {
      return []
    }

    const startedPart: ContextPartEnvelope = contextActionPartSchema.parse(
      cleanRecord({
        type: "action" as const,
        content: cleanRecord({
          status: "started" as const,
          actionName,
          actionCallId,
          input: "input" in record ? record.input : undefined,
        }),
        reactorMetadata,
      }),
    )

    if (record.state === "output-available") {
      return [
        startedPart,
        contextActionPartSchema.parse(
          cleanRecord({
            type: "action" as const,
            content: {
              status: "completed" as const,
              actionName,
              actionCallId,
              output: record.output,
            },
            reactorMetadata,
          }),
        ),
      ]
    }

    if (record.state === "output-error") {
      return [
        startedPart,
        contextActionPartSchema.parse(
          cleanRecord({
            type: "action" as const,
            content: {
              status: "failed" as const,
              actionName,
              actionCallId,
              error: {
                message:
                  typeof record.errorText === "string" && record.errorText.length > 0
                    ? record.errorText
                    : "Action execution failed.",
              },
            },
            reactorMetadata,
          }),
        ),
      ]
    }

    return [startedPart]
  }

  return []
}

export function normalizePartsForPersistence(parts: unknown[]): ContextPartEnvelope[] {
  return parts.flatMap((part) => {
    if (isContextPartEnvelope(part)) {
      return [parseContextPartEnvelope(part)]
    }
    return normalizeUiPartToContextPartEnvelopes(part)
  })
}
