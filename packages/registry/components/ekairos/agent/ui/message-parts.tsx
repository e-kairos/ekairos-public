"use client";

import React, { Fragment, memo, useEffect, useMemo, useState } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Sources,
  SourcesContent,
  SourcesTrigger,
  Source,
} from "@/components/ai-elements/sources";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ekairos/tools/tool";
import { CodexStepsParts } from "./reactors/codex-steps-parts";
import { FileIcon } from "@/components/ekairos/prompt/file-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrainCircuitIcon, CopyIcon, Mail, MessageCircle } from "lucide-react";

import type { AgentClassNames } from "../types";

function humanizeToolName(toolName: string): string {
  const map: Record<string, string> = {
    // Award / Bid ops (buyer-friendly)
    createBid: "Crear oferta",
    updateBid: "Actualizar oferta",
    addBidItems: "Agregar ítems a la oferta",
    updateBidItem: "Actualizar ítems (cantidades/precios)",
    linkBidItem: "Vincular ítem con lo solicitado",
    createPricingRule: "Crear regla de precio",
    removePricingRule: "Eliminar regla de precio",

    // Control / escalation
    requestDirection: "Escalar a soporte interno",
    end: "Finalizar",
    "codex-event": "Codex event",
  };

  if (map[toolName]) return map[toolName];

  // Fallback: camelCase/snake_case -> Title Case
  return toolName
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
}

function summarizeToolPart(part: any): string {
  const partType = String(part?.type ?? "");
  const toolName =
    partType === "codex-event" ? "codex-event" : partType.replace(/^tool-/, "");
  const state = String(part?.state ?? "");
  const out = part?.output;
  const err = typeof part?.errorText === "string" ? part.errorText : "";
  const metadata =
    part?.metadata && typeof part.metadata === "object"
      ? (part.metadata as Record<string, unknown>)
      : null;

  if (toolName === "codex-event") {
    const phase =
      typeof metadata?.phase === "string" ? metadata.phase : "";
    const label =
      out && typeof out === "object" && typeof (out as any).label === "string"
        ? String((out as any).label)
        : "";
    if (label) return label;
    if (phase) return phase;
    if (state === "output-available") return "Codex event completed";
    if (state === "output-error") return "Codex event failed";
    return "Codex event";
  }

  if (state === "output-error") {
    return err ? `Error: ${err}` : "Error";
  }

  // Prefer structured outputs used across the domain services
  if (out && typeof out === "object") {
    const success =
      typeof out.success === "boolean" ? (out.success as boolean) : undefined;
    const msg = typeof out.message === "string" ? out.message : "";

    if (toolName === "createBid") {
      const bidId = typeof out.bidId === "string" ? out.bidId : "";
      if (success === false) return msg || "No se pudo crear la oferta";
      if (bidId) return `Oferta creada (ID: ${bidId})`;
      if (msg) return msg;
      return "Oferta creada";
    }

    if (toolName === "addBidItems") {
      const ok = typeof out.successCount === "number" ? out.successCount : null;
      const fail =
        typeof out.failureCount === "number" ? out.failureCount : null;
      if (success === false) return msg || "No se pudieron agregar ítems";
      if (ok !== null || fail !== null) {
        const okTxt = ok !== null ? `${ok} OK` : "";
        const failTxt = fail !== null ? `${fail} con error` : "";
        return (
          [okTxt, failTxt].filter(Boolean).join(" · ") || "Ítems procesados"
        );
      }
      if (msg) return msg;
      return "Ítems agregados";
    }

    if (success === true && msg) return msg;
    if (success === false && msg) return msg;
  }

  if (state === "output-available") return "Completado";
  if (state === "input-available") return "Ejecutando…";
  if (state === "input-streaming") return "Pendiente…";
  return "";
}

const MessageParts = memo(function MessageParts({
  message,
  status,
  isLatest,
  toolComponents,
  classNames,
  showReasoning = true,
}: any) {
  const isStreaming = status === "streaming" && isLatest;

  const [isCoTOpen, setIsCoTOpen] = useState(isStreaming);
  const [channelView, setChannelView] = useState<"none" | "email" | "whatsapp">(
    "none"
  );

  // Some AI SDK streams can transiently materialize multiple parts for the same toolCall while it
  // transitions from input-streaming -> output-available. For createMessage we render it as a message,
  // so we de-dupe by only rendering the last createMessage tool part.
  const lastCreateMessagePartIdx = useMemo(() => {
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (let idx = parts.length - 1; idx >= 0; idx--) {
      const p = parts[idx];
      const toolName =
        typeof p?.type === "string" ? String(p.type).replace(/^tool-/, "") : "";
      if (toolName === "createMessage") return idx;
    }
    return -1;
  }, [message?.parts]);

  const codexParts = useMemo(
    () =>
      (Array.isArray(message?.parts) ? message.parts : []).filter(
        (p: any) => p && typeof p === "object" && p.type === "codex-event"
      ),
    [message?.parts],
  );

  const firstCodexPartIdx = useMemo(() => {
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (let idx = 0; idx < parts.length; idx += 1) {
      const p = parts[idx];
      if (p && typeof p === "object" && p.type === "codex-event") return idx;
    }
    return -1;
  }, [message?.parts]);

  useEffect(() => {
    setIsCoTOpen(Boolean(isStreaming));
  }, [isStreaming]);

  const handleCopy = (text: string) => {
    if (!text) return;
    const roleLabel = message.role === "user" ? "User" : "Assistant";
    navigator.clipboard.writeText(`${roleLabel}: ${text}`);
  };

  const renderTool = (part: any, i: number) => {
    const partType = String(part?.type ?? "");
    const toolName =
      partType === "codex-event" ? "codex-event" : partType.replace(/^tool-/, "");
    const ToolComponent = toolComponents?.[toolName];

    // Special case: createMessage should render like a normal assistant message,
    // not like a verbose tool card.
    if (toolName === "createMessage") {
      if (lastCreateMessagePartIdx !== -1 && i !== lastCreateMessagePartIdx) {
        return null;
      }
      const out = part?.output;
      const inp = part?.input;
      const args = part?.args;

      let text = "";
      if (typeof out === "string") text = out;
      else if (
        out &&
        typeof out === "object" &&
        typeof out.message === "string"
      ) {
        text = out.message;
      } else if (typeof inp?.message === "string") {
        text = inp.message;
      } else if (typeof args?.message === "string") {
        text = args.message;
      }

      if (!text || text.trim().length === 0) return null;

      return (
        <Message
          key={i}
          data-testid={`message-${message.role}`}
          from={message.role}
          className={cn(
            message.role === "user"
              ? (classNames as AgentClassNames | undefined)?.message?.user
              : (classNames as AgentClassNames | undefined)?.message?.assistant
          )}
        >
          <MessageContent
            className={cn(
              message.role === "user"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-transparent pl-0 py-0",
              (classNames as AgentClassNames | undefined)?.message?.content
            )}
          >
            <MessageResponse>{text}</MessageResponse>
          </MessageContent>
        </Message>
      );
    }

    if (ToolComponent) {
      return (
        <ToolComponent
          key={i}
          input={part.input}
          output={part.output}
          errorText={part.errorText}
        />
      );
    }

    const label = humanizeToolName(toolName || "Tool");
    const summary = summarizeToolPart(part);

    return (
      <Tool key={i}>
        <ToolHeader
          type={(part?.type as any) || ("tool" as any)}
          state={(part?.state as any) || ("input-streaming" as any)}
          label={label}
          summary={summary}
        />
        <ToolContent>
          {part.input && <ToolInput input={part.input} />}
          {!part.input && (
            <div className="p-3 text-xs text-muted-foreground italic">
              Running tool...
            </div>
          )}
          {part.output && <ToolOutput output={part.output} />}
          {part.errorText && <ToolOutput errorText={part.errorText} />}
        </ToolContent>
      </Tool>
    );
  };

  const sources = message.parts.filter((p: any) => p.type === "source-url");

  const reasoningParts = message.parts
    .filter((p: any) => {
      if (p.type !== "reasoning") return false;
      if (isStreaming) return true;
      return p.text && p.text.trim().length > 0;
    })
    .map((p: any, idx: number) => ({ ...p, originalIndex: idx }));

  const combinedReasoningText = reasoningParts
    .map((p: any) => p.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const hasReasoningContent = isStreaming || combinedReasoningText.length > 0;

  const extractTitle = (text: string): { title: string; content: string } => {
    const boldMatch = text.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      const title = boldMatch[1];
      const content = text.replace(/\*\*(.+?)\*\*\s*\n?/, "").trim();
      return { title, content };
    }
    return { title: "Chain of Thought", content: text };
  };

  const { title: reasoningTitle, content: reasoningContent } = extractTitle(
    combinedReasoningText
  );

  const renderAttachments = (parts: any[]) => {
    const attachments = parts
      .filter((p) => p.type === "file")
      .map((p) => ({
        filename: p.filename || "file",
        url: p.providerMetadata?.instant?.downloadUrl,
        mediaType: p.mediaType,
      }));

    if (attachments.length === 0) return null;

    return (
      <Message
        from={message.role}
        className={cn(
          message.role === "user"
            ? (classNames as AgentClassNames | undefined)?.message?.user
            : (classNames as AgentClassNames | undefined)?.message?.assistant
        )}
      >
        <MessageContent
          className={
            (classNames as AgentClassNames | undefined)?.message?.content
          }
        >
          <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((att: any, i: number) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 p-2 rounded border bg-background/50 hover:bg-accent transition-colors text-xs max-w-[200px] truncate"
              >
                <FileIcon
                  name={att.filename}
                  type={att.mediaType}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate">{att.filename}</span>
              </a>
            ))}
          </div>
        </MessageContent>
      </Message>
    );
  };

  const msgMeta =
    message && typeof message === "object"
      ? ((message as Record<string, unknown>).metadata as unknown)
      : null;
  const metaRecord =
    msgMeta && typeof msgMeta === "object"
      ? (msgMeta as Record<string, unknown>)
      : null;
  const channelEmails = metaRecord ? metaRecord.emails : undefined;
  const channelWhatsappMessages = metaRecord
    ? metaRecord.whatsappMessages
    : undefined;
  const normalizedEmails = Array.isArray(channelEmails)
    ? channelEmails
    : channelEmails
      ? [channelEmails]
      : [];
  const normalizedWhatsapp = Array.isArray(channelWhatsappMessages)
    ? channelWhatsappMessages[0]
    : channelWhatsappMessages;
  const hasEmail = normalizedEmails.length > 0;
  const hasWhatsapp = Boolean(normalizedWhatsapp);

  const handleToggleView = (next: "email" | "whatsapp") => {
    setChannelView((prev) => (prev === next ? "none" : next));
  };

  const renderChannelButtons = () => {
    if (!hasEmail && !hasWhatsapp) return null;
    return (
      <div className="mt-2 flex gap-2">
        {hasEmail && (
          <Button
            size="sm"
            variant={channelView === "email" ? "default" : "outline"}
            onClick={() => handleToggleView("email")}
            className="h-7 px-2 text-xs"
          >
            <Mail className="h-3 w-3 mr-1" />
            Email
          </Button>
        )}
        {hasWhatsapp && (
          <Button
            size="sm"
            variant={channelView === "whatsapp" ? "default" : "outline"}
            onClick={() => handleToggleView("whatsapp")}
            className="h-7 px-2 text-xs"
          >
            <MessageCircle className="h-3 w-3 mr-1" />
            WhatsApp
          </Button>
        )}
      </div>
    );
  };

  const renderChannelContent = () => {
    if (channelView === "none") return null;
    if (channelView === "email") {
      return (
        <div className="mt-2 rounded border bg-muted/30 p-3 text-xs">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(normalizedEmails, null, 2)}
          </pre>
        </div>
      );
    }
    if (channelView === "whatsapp") {
      return (
        <div className="mt-2 rounded border bg-muted/30 p-3 text-xs">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(normalizedWhatsapp, null, 2)}
          </pre>
        </div>
      );
    }
    return null;
  };

  return (
    <Fragment>
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

      {message.role === "assistant" &&
        (showReasoning && hasReasoningContent ? (
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
        ) : null)}

      {message.parts.map((part: any, i: number) => {
        if (part.type === "reasoning") return null;

        if (part.type === "codex-event") {
          if (i !== firstCodexPartIdx) return null;
          return <CodexStepsParts key={`codex-steps:${i}`} parts={codexParts} />;
        }

        if (part.type === "text") {
          return (
            <Fragment key={i}>
              <Message
                data-testid={`message-${message.role}`}
                from={message.role}
                className={cn(
                  message.role === "user"
                    ? (classNames as AgentClassNames | undefined)?.message?.user
                    : (classNames as AgentClassNames | undefined)?.message
                        ?.assistant
                )}
              >
                <MessageContent
                  className={cn(
                    message.role === "user"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-transparent pl-0 py-0",
                    (classNames as AgentClassNames | undefined)?.message
                      ?.content
                  )}
                >
                  <MessageResponse>{part.text}</MessageResponse>
                </MessageContent>
              </Message>

              {message.role === "assistant" &&
                i === message.parts.length - 1 && (
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
          );
        }

        if (
          typeof part.type === "string" &&
          part.type.startsWith("tool-")
        ) {
          return renderTool(part, i);
        }

        return null;
      })}

      {renderAttachments(message.parts)}
      {renderChannelButtons()}
      {renderChannelContent()}
    </Fragment>
  );
});

export { MessageParts };
