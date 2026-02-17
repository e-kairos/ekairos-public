"use client"

import React, { useState, useMemo, useCallback, Fragment, memo, useDeferredValue } from "react"
import { useChat } from "@ai-sdk-tools/store"
import { useChatMessages, useChatStatus, useChatActions } from "@ai-sdk-tools/store"
import { DefaultChatTransport } from "ai"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message"
import { Prompt } from "@/components/ekairos/prompt/prompt"
import { CopyIcon, RefreshCcwIcon, Download as DownloadIcon } from "lucide-react"
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought"
import { Loader } from "@/components/ai-elements/loader"
import { BrainCircuitIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ekairos/tools/tool"
import type { ToolComponentType } from "@/components/ekairos/tools/types"
import { id } from "@instantdb/react"
import type { PromptAttachment } from "@/components/ekairos/prompt/prompt-file-chip"
import { useOrgDb } from "@/lib/org-db-context"
import { FileIcon } from "@/components/ekairos/prompt/file-icon"

type FileUIPart = {
  type: "file";
  url?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: any;
}

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: any[];
  metadata?: any;
}


// Model selection is disabled on frontend; backend chooses GPT-5 except for web search

export const INPUT_TEXT_ITEM_TYPE = "user.message"
export const OUTPUT_TEXT_ITEM_TYPE = "assistant.message"


export type AgentEventForUI = {
  id: string
  type: string
  channel: string
  createdAt: string | Date
  content: { parts: any[] }
  status?: string
}

function convertToUIMessage(event: AgentEventForUI): UIMessage {
  let role: "user" | "assistant"
  if (event.type === INPUT_TEXT_ITEM_TYPE) {
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

type AgentChatProps = {
  className?: string
  initialContextId?: string
  apiUrl?: string
  toolComponents?: Record<string, ToolComponentType>
  onContextUpdate?: (contextId: string) => void
}

type ChatAttachment = PromptAttachment & {
  filePart?: FileUIPart
  path?: string
  fileId?: string
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file"
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exponent)
  const formatted = exponent === 0 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")
  return formatted + " " + units[exponent]
}


export default function Agent({ apiUrl, toolComponents, onContextUpdate, initialContextId, className }: AgentChatProps) {
  const { db } = useOrgDb();
  const [input, setInput] = useState("")
  const [webSearch, setWebSearch] = useState(false)
  const [contextId, setContextId] = useState<string | null>(initialContextId || null)
  const [reasoningLevel, setReasoningLevel] = useState<"off" | "low" | "medium" | "high">("low")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const isUploading = useMemo(() => attachments.some((att) => att.status === "uploading"), [attachments])
  const fileParts = useMemo(() => (
    attachments
      .filter((att) => att.status === "done" && att.filePart)
      .map((att) => att.filePart as FileUIPart)
  ), [attachments])

  const handleContextUpdate = useCallback((nextId: string) => {
    setContextId(nextId)
    if (typeof onContextUpdate === "function") {
      onContextUpdate(nextId)
    }
  }, [onContextUpdate])

  const uploadAttachment = useCallback(async (file: File, attachmentId: string) => {
    try {
      if (!file) {
        return
      }

      const contextSegment = contextId ?? "unassigned"
      const sanitizedName = sanitizeFileName(file.name || "file")
      const storagePath = `/agent/${contextSegment}/${Date.now()}-${sanitizedName}`
      const uploadResult = await db.storage.uploadFile(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        contentDisposition: file.name,
      })
      const uploadData: any = (uploadResult as any)?.data ?? uploadResult ?? {}
      const fileId = uploadData?.id ? String(uploadData.id) : null
      const downloadResult = await db.storage.getDownloadUrl(storagePath)
      const downloadUrl = typeof downloadResult === "string" ? downloadResult : downloadResult?.url
      if (!downloadUrl) {
        throw new Error("download url not returned")
      }
      const filePart: FileUIPart = {
        type: "file",
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
        url: downloadUrl, // Use the actual download URL instead of data:fileId format
      }
      const providerMetadata: Record<string, unknown> = {
        path: storagePath,
        downloadUrl,
        size: file.size,
      }
      if (fileId) {
        providerMetadata.fileId = fileId
      }
      if (Object.keys(providerMetadata).length > 0) {
        (filePart as any).providerMetadata = { instant: providerMetadata }
      }
      setAttachments((prev) => prev.map((att) => {
        if (att.id !== attachmentId) {
          return att
        }
        return {
          ...att,
          status: "done",
          url: downloadUrl,
          type: file.type || att.type,
          filePart,
          fileId: fileId ?? att.fileId,
          path: storagePath,
        }
      }))
    } catch (error) {
      console.error("Error uploading attachment", error)
      setAttachments((prev) => prev.map((att) => att.id === attachmentId ? { ...att, status: "error" } : att))
    }
  }, [contextId])

  const handleFilesSelected = useCallback((files: FileList) => {
    if (!files || files.length === 0) {
      return
    }
    const entries = Array.from(files).filter(Boolean)
    if (entries.length === 0) {
      return
    }
    const prepared = entries.map((file) => {
      const attachmentId = id()
      const attachment: ChatAttachment = {
        id: attachmentId,
        name: file.name,
        status: "uploading",
        type: file.type || undefined,
        size: formatBytes(file.size),
      }
      return { attachment, file }
    })
    setAttachments((prev) => [...prev, ...prepared.map(({ attachment }) => attachment)])
    prepared.forEach(({ file, attachment }) => {
      void uploadAttachment(file, attachment.id)
    })
  }, [uploadAttachment])

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== attachmentId))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])


  return (
    <div className={`max-w-4xl mx-auto relative size-full h-full ${className}`}>
      <div className="flex flex-col h-full">
        <ChatBootstrap onContextUpdate={handleContextUpdate} apiUrl={apiUrl} />

        <Conversation className="h-full">
          <ConversationContent>
            <MessageList contextId={contextId} toolComponents={toolComponents} />
            <ListLoader />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptBar
          input={input}
          setInput={setInput}
          webSearch={webSearch}
          setWebSearch={setWebSearch}
          reasoningLevel={reasoningLevel}
          setReasoningLevel={setReasoningLevel}
          contextId={contextId}
          attachments={attachments}
          onFilesSelected={handleFilesSelected}
          onRemoveAttachment={handleRemoveAttachment}
          isUploading={isUploading}
          fileParts={fileParts}
          onClearAttachments={clearAttachments}
        />
      </div>
    </div>
  )
}

type BootstrapProps = {
  onContextUpdate: (contextId: string) => void
  apiUrl?: string
}

const ChatBootstrap = memo(function ChatBootstrap({ onContextUpdate, apiUrl }: BootstrapProps) {
  if (!apiUrl) {
    throw new Error("apiUrl is required")
  }
  useChat({
    onData: (data) => {
      if (data.type === "data-context-id") {
        const payload = data.data as any
        if (payload && typeof payload.contextId === "string") {
          onContextUpdate(payload.contextId)
        }
      }
    },
    generateId: () => id(),
    transport: new DefaultChatTransport({
      api: apiUrl
    })
  })
  return null
})

type MessageListProps = {
  contextId: string | null
  toolComponents?: Record<string, ToolComponentType>
}

const MessageList = memo(function MessageList({ contextId, toolComponents }: MessageListProps) {
  const messages = useChatMessages()
  const deferredMessages = useDeferredValue(messages)
  const status = useChatStatus()

  const res = db.useQuery(contextId ? {
    agent_events: {
      $: {
        where: {
          "context.id": contextId,
          "status": "completed"
        },
      },
    },
  } : null)

  const converted = useMemo(() => {
    const eventList = res && res.data && Array.isArray(res.data.agent_events) ? res.data.agent_events : []
    const convertedEvents = eventList
      .map((ev: any) => convertToUIMessage(ev))
      .sort((a: any, b: any) => {
        const at = a && a.metadata && a.metadata.createdAt ? new Date(a.metadata.createdAt).getTime() : Number.POSITIVE_INFINITY
        const bt = b && b.metadata && b.metadata.createdAt ? new Date(b.metadata.createdAt).getTime() : Number.POSITIVE_INFINITY
        return at - bt
      })
    const convertedById = new Map<string, any>()
    for (const m of convertedEvents) {
      if (m && typeof m.id === "string") {
        convertedById.set(m.id, m)
      }
    }
    return { convertedEvents, convertedById }
  }, [res?.data?.agent_events])

  const derivedMessages = useMemo(() => {
    const streamingBase = Array.isArray(messages) ? messages : []
    const idleBase = Array.isArray(deferredMessages) ? deferredMessages : []

    if (status === "streaming") {
      return streamingBase
    }

    const baseById = new Map<string, any>()
    for (const m of idleBase) {
      if (m && typeof m.id === "string") {
        baseById.set(m.id, m)
      }
    }

    const storedOnly: any[] = []
    for (const ev of converted.convertedEvents) {
      const present = ev && typeof ev.id === "string" ? baseById.has(ev.id) : false
      if (!present) {
        storedOnly.push(ev)
      }
    }

    const tail: any[] = []
    for (const m of idleBase) {
      if (!m || typeof m.id !== "string") {
        continue
      }
      const stored = converted.convertedById.get(m.id)
      const storedStatus = stored && stored.metadata ? String(stored.metadata.status || "") : ""
      if (stored && storedStatus === "completed") {
        tail.push(stored)
      } else {
        tail.push(m)
      }
    }

    return [...storedOnly, ...tail]
  }, [messages, deferredMessages, converted, status])

  const renderSources = (message: any) => {
    if (message.role !== "assistant") {
      return null
    }

    const sources = message.parts.filter((part: any) => part.type === "source-url")
    if (sources.length === 0) {
      return null
    }

    return (
      <Sources>
        <SourcesTrigger count={sources.length} />
        {sources.map((part: any, i: number) => {
          return (
            <SourcesContent key={`${message.id}-${i}`}>
              <Source key={`${message.id}-${i}`} href={part.url} title={part.url} />
            </SourcesContent>
          )
        })}
      </Sources>
    )
  }

  const latestId = useMemo(() => {
    if (messages && messages.length > 0) {
      const last = messages[messages.length - 1]
      if (last && typeof last.id === "string") {
        return last.id
      }
    }
    return ""
  }, [messages])

  const [visibleCount, setVisibleCount] = React.useState<number>(100)

  const totalMessages = derivedMessages.length
  const startIndex = useMemo(() => {
    const start = totalMessages - visibleCount
    if (start > 0) {
      return start
    }
    return 0
  }, [totalMessages, visibleCount])

  const visibleMessages = useMemo(() => {
    return derivedMessages.slice(startIndex)
  }, [derivedMessages, startIndex])

  const hasMoreAbove = startIndex > 0

  return (
    <div>
      {hasMoreAbove ? (
        <div className="flex items-center justify-center py-2">
          <button
            type="button"
            className="text-xs px-3 py-1 rounded border bg-background hover:bg-accent/30"
            onClick={() => setVisibleCount(visibleCount + 100)}
          >
            Load 100 more
          </button>
        </div>
      ) : null}
      {visibleMessages.map((message: any) => {
        return (
          <div key={message.id}>
            {renderSources(message)}
            <MessageParts
              message={message}
              status={status}
              latestId={latestId}
              toolComponents={toolComponents}
            />
          </div>
        )
      })}
    </div>
  )
})

const ListLoader = memo(function ListLoader() {
  const status = useChatStatus()
  if (status !== "submitted") {
    return null
  }
  return <Loader />
})

type MessagePartsProps = {
  message: any
  status: "submitted" | "streaming" | "ready" | "error"
  latestId: string
  toolComponents?: Record<string, ToolComponentType>
}

const MessageParts = memo(function MessageParts({ message, status, latestId, toolComponents }: MessagePartsProps) {
  const { regenerate } = useChatActions()

  const isLatestAndStreaming = (index: number, total: number, idValue: string): boolean => {
    const isLastIndex = index === total - 1
    if (!isLastIndex) {
      return false
    }
    if (status !== "streaming") {
      return false
    }
    if (message.id !== idValue) {
      return false
    }
    return true
  }

  const handleCopy = (text: string) => {
    if (!text) {
      return
    }
    navigator.clipboard.writeText(text)
  }

  type InstantProviderMeta = { path?: string; downloadUrl?: string; size?: number; fileId?: string }
  type FilePart = { type: "file"; mediaType?: string; filename?: string; url?: string; providerMetadata?: { instant?: InstantProviderMeta } }

  const attachmentParts = useMemo(() => {
    const list: Array<{ filename: string; mediaType?: string; downloadUrl?: string; size?: number; isImage: boolean }> = []
    if (!message || !Array.isArray(message.parts)) {
      return list
    }
    for (const p of message.parts) {
      if (!p || p.type !== "file") {
        continue
      }
      const fp = p as FilePart
      const meta = fp.providerMetadata && fp.providerMetadata.instant ? fp.providerMetadata.instant : undefined
      const url = meta && typeof meta.downloadUrl === "string" ? meta.downloadUrl : undefined
      const name = typeof fp.filename === "string" && fp.filename.length > 0 ? fp.filename : "file"
      const mt = typeof fp.mediaType === "string" ? fp.mediaType : undefined
      const sz = meta && typeof meta.size === "number" ? meta.size : undefined
      const isImg = mt ? mt.startsWith("image/") : false
      list.push({ filename: name, mediaType: mt, downloadUrl: url, size: sz, isImage: isImg })
    }
    return list
  }, [message])

  const renderAttachments = () => {
    if (!attachmentParts || attachmentParts.length === 0) {
      return null
    }
    return (
      <Message from={message.role}>
        <MessageContent className="bg-transparent p-0">
          <div className="mt-1 rounded-md border p-3 bg-muted/30">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Attachments
            </div>
            <div className="flex flex-wrap gap-3">
              {attachmentParts.map((att, idx) => {
                const hasThumb = Boolean(att.isImage && att.downloadUrl)
                return (
                  <div key={`${message.id}-att-${idx}`} className="group flex items-center gap-3 rounded-md border p-3 bg-background hover:bg-accent/50 transition-colors">
                    {hasThumb ? (
                      <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={att.downloadUrl} alt={att.filename} className="h-12 w-12 rounded object-cover border" />
                      </a>
                    ) : (
                      <div className="h-12 w-12 rounded border flex items-center justify-center bg-muted/40">
                        <FileIcon name={att.filename} type={att.mediaType} className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      {att.downloadUrl ? (
                        <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline truncate block max-w-[240px]" title={att.filename}>
                          {att.filename}
                        </a>
                      ) : (
                        <span className="text-sm font-medium truncate block max-w-[240px]" title={att.filename}>{att.filename}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {att.mediaType ? att.mediaType : ""}{typeof att.size === "number" ? (att.mediaType ? " · " : "") + formatBytes(att.size) : ""}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {att.downloadUrl ? (
                        <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted" title="Download">
                          <DownloadIcon className="h-4 w-4" />
                        </a>
                      ) : null}
                      {att.downloadUrl ? (
                        <button type="button" className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted" title="Copy link" onClick={() => handleCopy(att.downloadUrl || "")}>
                          <CopyIcon className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Fragment>
      {message.parts.map((part: any, i: number) => {
        const isStreaming = isLatestAndStreaming(i, message.parts.length, latestId)

        if (part.type === "text") {
          return (
            <Fragment key={`${message.id}-${i}`}>
              <Message from={message.role}>
                <MessageContent className="bg-transparent pl-0">
                  <div className="whitespace-pre-wrap">{part.text}</div>
                </MessageContent>
              </Message>
              <AssistantMessageActions
                shouldRender={message.role === "assistant" && i === message.parts.length - 1}
                onRetry={regenerate}
                onCopy={() => handleCopy(part.text)}
              />
            </Fragment>
          )
        }

        if (
          part.type === "reasoning" &&
          !(part.state === "done" && (part.text === "" || part.text == null))
        ) {
          return (
            <ChainOfThought key={`${message.id}-${i}`} defaultOpen={isStreaming}>
              <ChainOfThoughtHeader>Razonamiento</ChainOfThoughtHeader>
              <ChainOfThoughtContent>
                <ChainOfThoughtStep
                  icon={BrainCircuitIcon}
                  label="Reasoning"
                  status={isStreaming ? "active" : "complete"}
                >
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {part.text}
                  </div>
                </ChainOfThoughtStep>
              </ChainOfThoughtContent>
            </ChainOfThought>
          )
        }

        if (part.type === "file") {
          return null
        }

        if (typeof part?.type === "string" && part.type.startsWith("tool-")) {
          const toolName = part.type.slice("tool-".length)
          const state = (String(part.state || "") as "input-streaming" | "input-available" | "output-available" | "output-error")
          const Custom = toolComponents && toolComponents[toolName]
          const label = (Custom && (Custom as any)?.meta?.title) || undefined

          if (toolName === "createMessage") {
            let displayedText = ""
            if (state === "output-available") {
              if (part && part.output) {
                if (typeof part.output === "object" && typeof part.output.message === "string") {
                  displayedText = part.output.message
                } else {
                  if (typeof part.output === "string") {
                    displayedText = part.output
                  } else {
                    displayedText = JSON.stringify(part.output)
                  }
                }
              }
            } else {
              if (part && part.input) {
                if (typeof part.input === "object" && typeof part.input.message === "string") {
                  displayedText = part.input.message
                } else {
                  if (typeof part.input === "string") {
                    displayedText = part.input
                  } else {
                    displayedText = JSON.stringify(part.input)
                  }
                }
              }
            }

            return (
              <Fragment key={`${message.id}-${i}`}>
                <Message from={message.role}>
                  <MessageContent className="bg-transparent pl-0">
                    <div className="whitespace-pre-wrap">{displayedText}</div>
                  </MessageContent>
                </Message>
                <AssistantMessageActions
                  shouldRender={message.role === "assistant" && i === message.parts.length - 1}
                  onRetry={regenerate}
                  onCopy={() => handleCopy(displayedText)}
                />
              </Fragment>
            )
          }

          if (Custom) {
            if (state === "output-error") {
              return (
                <div key={`${message.id}-${i}`} className="rounded-md border p-4">
                  <div className="text-xs text-destructive">{String(part?.errorText || "Error")}</div>
                  {label ? (<div className="mt-2 text-[11px] text-muted-foreground text-right">{label}</div>) : null}
                </div>
              )
            }

            if (state === "output-available") {
              return (
                <div key={`${message.id}-${i}`} className="rounded-md border p-4">
                  {React.createElement(Custom, { input: part?.input, output: part?.output, state, errorText: part?.errorText })}
                  {label ? (<div className="mt-2 text-[11px] text-muted-foreground text-right">{label}</div>) : null}
                </div>
              )
            }

            if (state === "input-available" || state === "input-streaming") {
              return (
                <div key={`${message.id}-${i}`} className="rounded-md border p-4">
                  {React.createElement(Custom, { input: part?.input, output: undefined, state, errorText: undefined })}
                  {label ? (<div className="mt-2 text-[11px] text-muted-foreground text-right">{label}</div>) : null}
                </div>
              )
            }

            return (
              <div key={`${message.id}-${i}`} className="rounded-md border p-4">
                <div className="text-xs">{state}</div>
                {label ? (<div className="mt-2 text-[11px] text-muted-foreground text-right">{label}</div>) : null}
              </div>
            )
          }

          return (
            <Tool key={`${message.id}-${i}`}>
              <ToolHeader type={part.type} state={state} label={label} />
              <ToolContent>
                {part?.input ? (<ToolInput input={part.input} />) : null}
                {state === "input-available" || state === "input-streaming" ? (<div className="p-4 text-xs opacity-70">Running...</div>) : null}
                {state === "output-error" ? (<ToolOutput output={undefined} errorText={String(part?.errorText || "Error")} />) : null}
                {state === "output-available" ? (<ToolOutput output={part?.output} errorText={undefined} />) : null}
              </ToolContent>
            </Tool>
          )
        }

        return null
      })}
      {renderAttachments()}
    </Fragment>
  )
})

type AssistantMessageActionsProps = {
  shouldRender: boolean
  onRetry: () => Promise<void>
  onCopy: () => void
}

const AssistantMessageActions = memo(function AssistantMessageActions({ shouldRender, onRetry, onCopy }: AssistantMessageActionsProps) {
  if (!shouldRender) {
    return null
  }
  return (
    <div className="mt-2 flex gap-2">
      <Button
        size="icon"
        className="h-7 w-7"
        variant="ghost"
        onClick={onRetry}
        title="Retry"
      >
        <RefreshCcwIcon className="size-3" />
      </Button>
      <Button
        size="icon"
        className="h-7 w-7"
        variant="ghost"
        onClick={onCopy}
        title="Copy"
      >
        <CopyIcon className="size-3" />
      </Button>
    </div>
  )
})

type PromptBarProps = {
  input: string
  setInput: (value: string) => void
  webSearch: boolean
  setWebSearch: (value: boolean) => void
  reasoningLevel: "off" | "low" | "medium" | "high"
  setReasoningLevel: (value: "off" | "low" | "medium" | "high") => void
  contextId: string | null
  attachments: PromptAttachment[]
  onFilesSelected: (files: FileList) => void
  onRemoveAttachment: (id: string) => void
  isUploading: boolean
  fileParts: FileUIPart[]
  onClearAttachments: () => void
}

const PromptBar = memo(function PromptBar({ input, setInput, webSearch, setWebSearch, reasoningLevel, setReasoningLevel, contextId, attachments, onFilesSelected, onRemoveAttachment, isUploading, fileParts, onClearAttachments }: PromptBarProps) {
  const status = useChatStatus()
  const { sendMessage } = useChatActions()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isUploading) {
      return
    }
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      return
    }
    const messagePayload = fileParts.length > 0 ? { text: trimmed, files: fileParts } : { text: trimmed }
    sendMessage(messagePayload as any, { body: { reasoningLevel, webSearch, contextId } })
    setInput("")
    onClearAttachments()
  }

  let promptStatus: "streaming" | "submitted" | "error" | "idle" = "idle"

  if (status === "streaming") {
    promptStatus = "streaming"
  }
  else if (status === "submitted") {
    promptStatus = "submitted"
  }
  else if (status === "error") {
    promptStatus = "error"
  }
  else {
    promptStatus = "idle"
  }

  const handleToggleWeb = () => {
    setWebSearch(!webSearch)
  }

  return (
    <Prompt
      value={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      webSearch={webSearch}
      onToggleWeb={handleToggleWeb}
      reasoningLevel={reasoningLevel}
      onChangeReasoning={setReasoningLevel}
      onFilesSelected={onFilesSelected}
      isUploading={isUploading}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      status={promptStatus}
    />
  )
})




