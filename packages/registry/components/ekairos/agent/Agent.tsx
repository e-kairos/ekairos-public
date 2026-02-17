"use client"

import React, { useState, useMemo, useCallback, Fragment, memo, useDeferredValue, useEffect, Suspense, useRef } from "react"
import { useChat, Provider, useChatMessages, useChatStatus, useChatActions } from "@ai-sdk-tools/store"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import { Prompt } from "@/components/ekairos/prompt/prompt"
import { CopyIcon, Download as DownloadIcon, BrainCircuitIcon, Loader2 } from "lucide-react"
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources"
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ekairos/tools/tool"
import { Button } from "@/components/ui/button"
import type { ToolComponentType } from "@/components/ekairos/tools/types"
import { id } from "@instantdb/react"
import type { PromptAttachment } from "@/components/ekairos/prompt/prompt-file-chip"
import { DefaultChatTransport } from "ai"
import { FileIcon } from "@/components/ekairos/prompt/file-icon"
import { cn } from "@/lib/utils"
import { useOrgDb } from "@/lib/org-db-context"

export function formatRelativeTime(dateInput: Date | string | number): string {
  const date = new Date(dateInput)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "hace un momento"
  if (diffInSeconds < 3600) return `hace ${Math.floor(diffInSeconds / 60)} min`
  if (diffInSeconds < 86400) return `hace ${Math.floor(diffInSeconds / 3600)} h`
  if (diffInSeconds < 604800) return `hace ${Math.floor(diffInSeconds / 86400)} d`
  return date.toLocaleDateString()
}

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
  const role = event.type === INPUT_TEXT_ITEM_TYPE ? "user" : "assistant"
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

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file"
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exponent)
  return (exponent === 0 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")) + " " + units[exponent]
}

export type AgentHistoryItem = {
  id: string
  title?: string
  createdAt: string | Date | number
}

type AgentChatProps = {
  initialContextId?: string
  apiUrl?: string
  toolComponents?: Record<string, ToolComponentType>
  onContextUpdate?: (contextId: string) => void
  classNames?: AgentClassNames
  showReasoning?: boolean
}

type AgentClassNames = {
  container?: string
  scrollArea?: string
  messageList?: string
  message?: {
    container?: string
    content?: string
    user?: string
    assistant?: string
  }
  prompt?: string
}

type ChatAttachment = PromptAttachment & {
  filePart?: FileUIPart
  path?: string
  fileId?: string
}

// --- Components ---

function AgentContent({ apiUrl, toolComponents, onContextUpdate, initialContextId, classNames, showReasoning = true }: AgentChatProps) {
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

  const { db, isLoading } = useOrgDb();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const isUuid = contextId ? uuidRegex.test(contextId) : false

  // Query context to pass to PromptBar
  const contextRes = db?.useQuery(contextId && db ? {
    thread_contexts: { $: { where: { id: contextId }, limit: 1 } },
  } : null)
  
  const context = contextRes?.data?.thread_contexts?.[0] || null

  useEffect(() => {
    if (initialContextId) setContextId(initialContextId)
    else setContextId(null)
  }, [initialContextId])

  const handleContextUpdate = useCallback((nextId: string) => {
    setContextId(nextId)
    onContextUpdate?.(nextId)
  }, [onContextUpdate])

  // File Upload Logic
  const uploadAttachment = useCallback(async (file: File, attachmentId: string) => {
    try {
      if (!file || !db) return
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
      
      if (!downloadUrl) throw new Error("download url not returned")

      const filePart: FileUIPart = {
        type: "file",
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
        url: downloadUrl, // Always use the download URL
      }
      
      const providerMetadata: Record<string, unknown> = { path: storagePath, downloadUrl, size: file.size }
      if (fileId) providerMetadata.fileId = fileId
      if (Object.keys(providerMetadata).length > 0) (filePart as any).providerMetadata = { instant: providerMetadata }

      setAttachments((prev) => prev.map((att) => {
        if (att.id !== attachmentId) return att
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
  }, [contextId, db])

  const handleFilesSelected = useCallback((files: FileList) => {
    if (!files || files.length === 0) return
    const entries = Array.from(files).filter(Boolean)
    if (entries.length === 0) return
    
    const prepared = entries.map((file) => {
      const attachmentId = id()
      return { 
        attachment: {
          id: attachmentId,
          name: file.name,
          status: "uploading" as const,
          type: file.type || undefined,
          size: formatBytes(file.size),
        }, 
        file 
      }
    })
    
    setAttachments((prev) => [...prev, ...prepared.map(p => p.attachment)])
    prepared.forEach(({ file, attachment }) => void uploadAttachment(file, attachment.id))
  }, [uploadAttachment])

  const handleRemoveAttachment = useCallback((id: string) => setAttachments(prev => prev.filter(a => a.id !== id)), [])
  const clearAttachments = useCallback(() => setAttachments([]), [])

  if (!db) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          <p className="text-sm text-muted-foreground">Loading Database...</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      data-testid="chat-container"
      className={cn(
        "relative flex flex-col w-full h-full bg-background text-foreground overflow-hidden", 
        classNames?.container
      )}
    >
      <ChatBootstrap onContextUpdate={handleContextUpdate} apiUrl={apiUrl} contextId={contextId} />

      <Conversation className={cn("flex-1 min-h-0", classNames?.scrollArea)}>
        <ConversationContent className="p-4 md:p-6 space-y-6">
          <MessageList 
            contextId={contextId} 
            toolComponents={toolComponents} 
            classNames={classNames}
            showReasoning={showReasoning}
          />
          <ListLoader />
          <div className="h-4" /> {/* Spacer for bottom */}
        </ConversationContent>
        <ConversationScrollButton className="bottom-20 right-8" />
      </Conversation>

      <div className={cn("p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60", classNames?.prompt)}>
        <PromptBar
          input={input}
          setInput={setInput}
          webSearch={webSearch}
          setWebSearch={setWebSearch}
          reasoningLevel={reasoningLevel}
          setReasoningLevel={setReasoningLevel}
          contextId={contextId}
          context={context}
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

const ChatBootstrap = memo(function ChatBootstrap({ onContextUpdate, apiUrl, contextId }: { onContextUpdate: (id: string) => void, apiUrl?: string, contextId: string | null }) {
  if (!apiUrl) throw new Error("apiUrl is required")
  const { setMessages } = useChatActions()
  const previousContextIdRef = useRef<string | null>(null)

  // Reset messages when contextId changes between existing threads
  useEffect(() => {
    const previousContextId = previousContextIdRef.current
    const hasContextChanged = previousContextId !== contextId
    const shouldResetMessages = !!previousContextId && hasContextChanged

    if (shouldResetMessages) {
      setMessages([])
    }

    previousContextIdRef.current = contextId
  }, [contextId, setMessages])

  useChat({
    onData: (data) => {
      if (data.type === "data-context-id") {
        const payload = data.data as any
        if (payload?.contextId) onContextUpdate(payload.contextId)
      }
    },
    generateId: () => id(),
    transport: new DefaultChatTransport({ api: apiUrl })
  })
  return null
})

type MessageListProps = {
  contextId: string | null
  toolComponents?: Record<string, ToolComponentType>
  classNames?: AgentClassNames
  showReasoning?: boolean
}

const MessageList = memo(function MessageList({ contextId, toolComponents, classNames, showReasoning = true }: MessageListProps) {
  const messages = useChatMessages()
  const deferredMessages = useDeferredValue(messages)
  const status = useChatStatus()
  const { db } = useOrgDb()

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const isUuid = contextId ? uuidRegex.test(contextId) : false

  const res = db?.useQuery(contextId && db ? {
    thread_items: { $: { where: { "context.id": contextId } } },
    thread_contexts: { $: { where: { id: contextId }, limit: 1 } },
  } : null)

  const contextData = res?.data?.thread_contexts?.[0]
  const contextStatus = contextData?.status || "open"
  const canSendMessage = contextStatus === "open"

  const derivedMessages = useMemo(() => {
    // Merge DB history with realtime store
    const eventList = res?.data?.thread_items || []
    const convertedEvents = eventList.map((ev: any) => convertToUIMessage(ev))
    const baseById = new Map<string, any>()
    const liveMessages = status === "streaming" ? messages : deferredMessages

    liveMessages.forEach((m: any) => { if (m?.id) baseById.set(m.id, m) })

    const history = convertedEvents.filter((ev: any) => !baseById.has(ev.id))
      .sort((a: any, b: any) => new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime())

    const live = liveMessages.map((m: any) => {
      const stored = convertedEvents.find((e: any) => e.id === m.id)
      return (stored as any)?.metadata?.status === "completed" ? stored : m
    })

    return [...history, ...live]
  }, [res?.data?.thread_items, messages, deferredMessages, status])

  const [visibleCount, setVisibleCount] = useState(100)
  const visibleMessages = useMemo(() => derivedMessages.slice(Math.max(0, derivedMessages.length - visibleCount)), [derivedMessages, visibleCount])

  return (
    <div className={cn("w-full max-w-3xl mx-auto space-y-6", classNames?.messageList)}>
      {derivedMessages.length > visibleCount && (
        <div className="flex justify-center">
          <button
            onClick={() => setVisibleCount(prev => prev + 100)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Load older messages
          </button>
        </div>
      )}
      {visibleMessages.map((message: any) => (
        <div key={message.id} className={classNames?.message?.container}>
          <MessageParts
            message={message}
            status={status}
            isLatest={message === visibleMessages[visibleMessages.length - 1]}
            toolComponents={toolComponents}
            classNames={classNames}
            showReasoning={showReasoning}
          />
        </div>
      ))}
    </div>
  )
})

const ListLoader = memo(function ListLoader() {
  const status = useChatStatus()
  if (status !== "submitted") return null
  return (
    <div className="max-w-3xl mx-auto w-full px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="animate-pulse">Pensando...</span>
      </div>
    </div>
  )
})

const MessageParts = memo(function MessageParts({ message, status, isLatest, toolComponents, classNames, showReasoning = true }: any) {
  const isStreaming = status === "streaming" && isLatest

  // State for CoT collapse
  const [isCoTOpen, setIsCoTOpen] = useState(isStreaming)

  // Sync CoT state with streaming status
  useEffect(() => {
    if (isStreaming) {
      setIsCoTOpen(true)
    } else {
      setIsCoTOpen(false)
    }
  }, [isStreaming])

  const handleCopy = (text: string) => {
    if (text) {
      const roleLabel = message.role === "user" ? "User" : "Assistant"
      const formattedText = `${roleLabel}: ${text}`
      navigator.clipboard.writeText(formattedText)
    }
  }

  // Render Helper for Attachments
  const renderAttachments = (parts: any[]) => {
    const attachments = parts.filter(p => p.type === "file").map(p => ({
      filename: p.filename || "file",
      url: p.providerMetadata?.instant?.downloadUrl,
      isImage: p.mediaType?.startsWith("image/"),
      size: p.providerMetadata?.instant?.size,
      mediaType: p.mediaType
    }))

    if (attachments.length === 0) return null

    return (
      <Message from={message.role} className={cn(message.role === "user" ? classNames?.message?.user : classNames?.message?.assistant)}>
        <MessageContent variant="flat" className={classNames?.message?.content}>
          <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((att: any, i: number) => (
              <a 
                key={i} 
                href={att.url} 
                target="_blank" 
                rel="noopener" 
                className="flex items-center gap-2 p-2 rounded border bg-background/50 hover:bg-accent transition-colors text-xs max-w-[200px] truncate"
              >
                <FileIcon name={att.filename} type={att.mediaType} className="h-4 w-4 shrink-0" />
                <span className="truncate">{att.filename}</span>
              </a>
            ))}
          </div>
        </MessageContent>
      </Message>
    )
  }

  // Render Helper for Tool Calls
  const renderTool = (part: any, index: number) => {
    const toolName = part.type.replace("tool-", "")
    const state = part.state || "input-available"
    const Custom = toolComponents?.[toolName]
    const label = Custom?.meta?.title

    // Special handling for createMessage - render as markdown message instead of tool
    if (toolName === "createMessage") {
      let displayedText = ""
      
      // During streaming or when output is available, prioritize output
      if (state === "output-available" && part?.output) {
        if (typeof part.output === "object" && typeof part.output.message === "string") {
          displayedText = part.output.message
        } else if (typeof part.output === "string") {
          displayedText = part.output
        } else if (part.output) {
          displayedText = JSON.stringify(part.output)
        }
      } 
      // During streaming, check for partial text in output first, then input
      else if ((state === "input-streaming" || state === "output-streaming") && part?.output) {
        if (typeof part.output === "object" && typeof part.output.message === "string") {
          displayedText = part.output.message
        } else if (typeof part.output === "string") {
          displayedText = part.output
        } else if (part.output) {
          displayedText = JSON.stringify(part.output)
        }
      }
      // Fallback to input for initial states
      else if (part?.input) {
        if (typeof part.input === "object" && typeof part.input.message === "string") {
          displayedText = part.input.message
        } else if (typeof part.input === "string") {
          displayedText = part.input
        } else if (part.input) {
          displayedText = JSON.stringify(part.input)
        }
      }

      // Ensure displayedText is always a string for Streamdown
      const textToRender = typeof displayedText === "string" ? displayedText : String(displayedText || "")

      return (
        <Fragment key={index}>
          <Message 
            from={message.role} 
            className={cn(message.role === "user" ? classNames?.message?.user : classNames?.message?.assistant)}
          >
            <MessageContent 
              variant={message.role === "user" ? "contained" : "flat"} 
              className={cn(
                message.role === "user" 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "bg-transparent pl-0 py-0",
                classNames?.message?.content
              )}
            >
              <MessageResponse>{textToRender}</MessageResponse>
            </MessageContent>
          </Message>
          
          {/* Actions only for last assistant message */}
          {message.role === "assistant" && index === message.parts.length - 1 && (
            <div className="ml-0 mt-1 flex gap-2">
              <Button
                size="icon"
                className="h-7 w-7"
                variant="ghost"
                onClick={() => handleCopy(textToRender)}
                title="Copy"
              >
                <CopyIcon className="size-3" />
              </Button>
            </div>
          )}
        </Fragment>
      )
    }

    if (Custom) {
      return (
        <div key={index} className="my-2 border rounded-lg overflow-hidden bg-card/50">
          {React.createElement(Custom, { 
            input: part.input, 
            output: part.output, 
            state, 
            errorText: part.errorText 
          })}
          {label && <div className="bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground text-right">{label}</div>}
        </div>
      )
    }

    // Default Tool Render
    return (
      <Tool key={index} className="my-2">
        <ToolHeader type={part.type} state={state} label={label} />
        <ToolContent>
          {part.input && <ToolInput input={part.input} />}
          {state.includes("running") && <div className="p-3 text-xs text-muted-foreground italic">Running tool...</div>}
          {part.output && <ToolOutput output={part.output} />}
          {part.errorText && <ToolOutput errorText={part.errorText} />}
        </ToolContent>
      </Tool>
    )
  }

  // Render Helper for Sources
  const sources = message.parts.filter((p: any) => p.type === "source-url")
  
  // Group reasoning parts together
  // When streaming: show all parts (even empty ones, as they may be filling)
  // When finished: filter out empty parts
  const reasoningParts = message.parts
    .filter((p: any) => {
      if (p.type !== "reasoning") return false
      // If streaming, show all reasoning parts
      if (isStreaming) return true
      // If finished, only show non-empty parts
      return p.text && p.text.trim().length > 0
    })
    .map((p: any, idx: number) => ({ ...p, originalIndex: idx }))
  
  // Combine all reasoning text and check if it's not empty
  const combinedReasoningText = reasoningParts.map((p: any) => p.text).filter(Boolean).join('\n\n').trim()
  const hasReasoningContent = isStreaming || combinedReasoningText.length > 0
  
  // Check for visible content (text or tools) to toggle "Thinking..."
  const hasVisibleContent = message.parts.some((p: any) => 
    (p.type === "text" && p.text && p.text.trim().length > 0) || 
    (typeof p.type === "string" && p.type.startsWith("tool-")) ||
    p.type === "file"
  )

  // Extract title from markdown bold (**text**)
  const extractTitle = (text: string): { title: string; content: string } => {
    const boldMatch = text.match(/\*\*(.+?)\*\*/)
    if (boldMatch) {
      const title = boldMatch[1]
      const content = text.replace(/\*\*(.+?)\*\*\s*\n?/, '').trim()
      return { title, content }
    }
    return { title: "Chain of Thought", content: text }
  }
  
  const { title: reasoningTitle, content: reasoningContent } = extractTitle(combinedReasoningText)

  return (
    <Fragment>
      {/* Sources (if any) */}
      {sources.length > 0 && message.role === "assistant" && (
        <Sources className="mb-2">
          <SourcesTrigger count={sources.length} />
          {sources.map((p: any, i: number) => (
            <SourcesContent key={i}>
              <Source href={p.url} title={p.url} />
            </SourcesContent>
          ))}
        </Sources>
      )}

      {/* Reasoning grouped together */}
      {message.role === "assistant" && (
        showReasoning && hasReasoningContent ? (
          <ChainOfThought 
            open={isCoTOpen} 
            onOpenChange={setIsCoTOpen} 
            className="mb-2"
          >
            <ChainOfThoughtHeader>{reasoningTitle}</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep 
                icon={BrainCircuitIcon}
                label={reasoningTitle}
                status={isStreaming ? "active" : "complete"}
              >
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {reasoningContent}
                </div>
              </ChainOfThoughtStep>
            </ChainOfThoughtContent>
          </ChainOfThought>
        ) : (
          !showReasoning && isStreaming && !hasVisibleContent && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="animate-pulse">Pensando...</span>
            </div>
          )
        )
      )}

      {/* Message Parts */}
      {message.parts.map((part: any, i: number) => {
        // Skip reasoning parts as they're rendered above
        if (part.type === "reasoning") {
          return null
        }

        if (part.type === "text") {
          return (
            <Fragment key={i}>
              <Message 
                data-testid={`message-${message.role}`}
                from={message.role} 
                className={cn(message.role === "user" ? classNames?.message?.user : classNames?.message?.assistant)}
              >
                <MessageContent 
                  variant={message.role === "user" ? "contained" : "flat"} 
                  className={cn(
                    message.role === "user" 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "bg-transparent pl-0 py-0",
                    classNames?.message?.content
                  )}
                >
                  <MessageResponse>{part.text}</MessageResponse>
                </MessageContent>
              </Message>
              
              {/* Actions only for last assistant message */}
              {message.role === "assistant" && i === message.parts.length - 1 && (
                <div className="ml-0 mt-1 flex gap-2">
                  <Button
                    size="icon"
                    className="h-7 w-7"
                    variant="ghost"
                    onClick={() => handleCopy(part.text)}
                    title="Copy"
                  >
                    <CopyIcon className="size-3" />
                  </Button>
                </div>
              )}
            </Fragment>
          )
        }

        if (typeof part.type === "string" && part.type.startsWith("tool-")) {
          return renderTool(part, i)
        }

        return null
      })}

      {renderAttachments(message.parts)}
    </Fragment>
  )
})

// Simplified PromptBar Wrapper
const PromptBar = memo(function PromptBar(props: any) {
  const status = useChatStatus()
  const { sendMessage } = useChatActions()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Check context status internally
  const contextStatus = props.context?.status || "open"
  const readOnlyStatuses = new Set(["closed"])
  const canSendMessage = !readOnlyStatuses.has(contextStatus)
  const isContextReadOnly = readOnlyStatuses.has(contextStatus)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (props.isUploading) return
    if (!canSendMessage) return // Block if context is not open
    if (isSubmitting || status === "streaming" || status === "submitted") return
    
    const trimmed = props.input.trim()
    if (!trimmed && props.fileParts.length === 0) return

    // Block immediately before sending
    setIsSubmitting(true)
    
    const payload = props.fileParts.length > 0 ? { text: trimmed, files: props.fileParts } : { text: trimmed }
    sendMessage(payload, { body: { webSearch: props.webSearch, reasoningLevel: props.reasoningLevel, contextId: props.contextId } })
    
    props.setInput("")
    props.onClearAttachments()
  }

  // Reset submitting state when streaming starts or status changes
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      setIsSubmitting(false)
    }
  }, [status])

  // Only show error status while actively processing, otherwise reset to idle
  const promptStatus = status === "streaming" 
    ? "streaming" 
    : status === "submitted" 
      ? "submitted" 
      : "idle"
  const isBusy = props.isUploading || isSubmitting || status === "streaming" || status === "submitted"
  const controlsDisabled = !canSendMessage || isBusy
  const inputDisabled = isContextReadOnly

  return (
    <Prompt
      value={props.input}
      onChange={props.setInput}
      onSubmit={handleSubmit}
      webSearch={props.webSearch}
      onToggleWeb={() => props.setWebSearch(!props.webSearch)}
      reasoningLevel={props.reasoningLevel}
      onChangeReasoning={props.setReasoningLevel}
      status={promptStatus}
      onFilesSelected={props.onFilesSelected}
      isUploading={props.isUploading}
      attachments={props.attachments}
      onRemoveAttachment={props.onRemoveAttachment}
      disabled={controlsDisabled}
      inputDisabled={inputDisabled}
    />
  )
})

// Public Component
export default function Agent(props: AgentChatProps) {
  return (
    <Provider>
      <Suspense fallback={
        <div className="flex h-full w-full items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            <p className="text-sm text-muted-foreground">Loading Agent...</p>
          </div>
        </div>
      }>
        <AgentContent {...props} />
      </Suspense>
    </Provider>
  )
}

