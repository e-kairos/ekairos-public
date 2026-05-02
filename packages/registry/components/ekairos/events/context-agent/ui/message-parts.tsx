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
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ekairos/tools/tool";
import { FileIcon } from "../../prompt/file-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyIcon } from "lucide-react";
import {
  getActionPartInfo,
  getCreateMessageText,
  getPartText,
  getReasoningState,
  getReasoningText,
  getSourceParts,
  normalizeContextEventParts,
} from "../../context/context-event-parts";

import type { AgentClassNames } from "../types";

export function humanizeToolName(toolName: string): string {
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

    canvasAgentChart: "Gráfico en chat",
    semanticDerivation: "Derivación semántica",
  };

  if (map[toolName]) return map[toolName];

  // Fallback: camelCase/snake_case -> Title Case
  return toolName
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
}

type ActionView = {
  actionName: string;
  actionCallId: string;
  startIndex: number;
  terminalIndex?: number;
  started?: unknown;
  terminal?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function actionViewInfo(view: ActionView) {
  const terminal = getActionPartInfo(view.terminal);
  const started = getActionPartInfo(view.started);
  const info = terminal ?? started;
  const state =
    terminal?.status === "failed"
      ? "output-error"
      : terminal?.status === "completed"
        ? "output-available"
        : "input-available";

  return {
    actionName: info?.actionName ?? view.actionName,
    actionCallId: info?.actionCallId ?? view.actionCallId,
    state,
    input: started?.input ?? terminal?.input,
    output: terminal?.output ?? started?.output,
    errorText: terminal?.errorText ?? started?.errorText,
  };
}

function summarizeToolPart(view: ActionView): string {
  const { actionName: toolName, state, output: out, errorText } = actionViewInfo(view);
  const err = typeof errorText === "string" ? errorText : "";

  if (state === "output-error") {
    return err ? `Error: ${err}` : "Error";
  }

  // Prefer structured outputs used across the domain services
  const outputRecord = asRecord(out);
  if (outputRecord) {
    const success =
      typeof outputRecord.success === "boolean"
        ? (outputRecord.success as boolean)
        : undefined;
    const msg =
      typeof outputRecord.message === "string" ? outputRecord.message : "";

    if (toolName === "createBid") {
      const bidId =
        typeof outputRecord.bidId === "string" ? outputRecord.bidId : "";
      if (success === false) return msg || "No se pudo crear la oferta";
      if (bidId) return `Oferta creada (ID: ${bidId})`;
      if (msg) return msg;
      return "Oferta creada";
    }

    if (toolName === "addBidItems") {
      const ok =
        typeof outputRecord.successCount === "number"
          ? outputRecord.successCount
          : null;
      const fail =
        typeof outputRecord.failureCount === "number"
          ? outputRecord.failureCount
          : null;
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
  surface = "conversation",
}: any) {
  const isStreaming = status === "streaming" && isLatest;
  const isStepSurface = surface === "step";
  const normalizedParts = useMemo(
    () =>
      normalizeContextEventParts(
        Array.isArray(message?.parts) ? message.parts : [],
      ),
    [message?.parts],
  );
  const actionPresentation = useMemo(() => {
    const startedById = new Map<string, ActionView>();
    const renderByIndex = new Map<number, ActionView>();
    const skipIndexes = new Set<number>();

    normalizedParts.forEach((part: unknown, index: number) => {
      const info = getActionPartInfo(part);
      if (!info) return;

      if (info.status === "started") {
        const view: ActionView = {
          actionName: info.actionName,
          actionCallId: info.actionCallId,
          startIndex: index,
          started: part,
        };
        startedById.set(info.actionCallId, view);
        renderByIndex.set(index, view);
        return;
      }

      const existing = startedById.get(info.actionCallId);
      if (existing) {
        existing.terminal = part;
        existing.terminalIndex = index;
        skipIndexes.add(index);
        return;
      }

      renderByIndex.set(index, {
        actionName: info.actionName,
        actionCallId: info.actionCallId,
        startIndex: index,
        terminalIndex: index,
        terminal: part,
      });
    });

    return { renderByIndex, skipIndexes };
  }, [normalizedParts]);

  const lastRenderableCreateMessageActionCallId = useMemo(() => {
    let pendingCallId = "";
    for (let idx = normalizedParts.length - 1; idx >= 0; idx--) {
      const part = normalizedParts[idx];
      const action = getActionPartInfo(part);
      if (action?.actionName !== "createMessage") continue;
      if (!getCreateMessageText(part)) continue;

      if (action.status === "completed") return action.actionCallId;
      if (isStreaming && !pendingCallId && action.status === "started") {
        pendingCallId = action.actionCallId;
      }
    }
    return pendingCallId;
  }, [isStreaming, normalizedParts]);

  const renderedCreateMessageTexts = useMemo(() => {
    const texts = new Set<string>();
    for (const part of normalizedParts) {
      const action = getActionPartInfo(part);
      if (action?.actionName !== "createMessage") continue;

      const text = getCreateMessageText(part).trim();
      if (text) texts.add(text);
    }
    return texts;
  }, [normalizedParts]);

  const [isCoTOpen, setIsCoTOpen] = useState(isStreaming);
  const [channelView, setChannelView] = useState<"none" | "email" | "whatsapp">(
    "none"
  );

  useEffect(() => {
    setIsCoTOpen(Boolean(isStreaming));
  }, [isStreaming]);

  const handleCopy = (text: string) => {
    if (!text) return;
    const roleLabel = message.role === "user" ? "User" : "Assistant";
    navigator.clipboard.writeText(`${roleLabel}: ${text}`);
  };

  const renderActionView = (view: ActionView, i: number) => {
    const { actionName: toolName, actionCallId, state, input, output, errorText } =
      actionViewInfo(view);
    const ToolComponent = toolComponents?.[toolName];

    if (toolName === "createMessage") {
      if (actionCallId !== lastRenderableCreateMessageActionCallId) return null;

      const text =
        getCreateMessageText(view.terminal) ||
        getCreateMessageText(view.started);
      if (!text) return null;

      if (isStepSurface) {
        return (
          <div
            key={i}
            data-testid="assistant-reply-part"
            className="text-sm leading-6 text-foreground"
          >
            <MessageResponse>{text}</MessageResponse>
          </div>
        );
      }

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
                ? userContentChrome
                : "bg-transparent pl-0 py-0",
              (classNames as AgentClassNames | undefined)?.message?.content,
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
          input={input}
          output={output}
          state={state}
          errorText={errorText}
          toolCallId={actionCallId}
        />
      );
    }

    const label = humanizeToolName(toolName || "Tool");
    const summary = summarizeToolPart(view);
    const headerSummary =
      summary === "Completado" ||
      summary === "Error" ||
      summary.startsWith("Ejecutando") ||
      summary.startsWith("Pendiente")
        ? undefined
        : summary;

    return (
      <Tool
        key={i}
        className={cn(
          isStepSurface && "mb-0 border-border/70 bg-background"
        )}
      >
        <ToolHeader
          type={`tool-${toolName}` as any}
          state={state as any}
          label={label}
          summary={headerSummary}
        />
        <ToolContent>
          {input !== undefined && <ToolInput input={input} />}
          {input === undefined && (
            <div className="p-3 text-xs text-muted-foreground italic">
              Ejecutando...
            </div>
          )}
          {output !== undefined && <ToolOutput output={output} />}
          {errorText && <ToolOutput errorText={errorText} />}
        </ToolContent>
      </Tool>
    );
  };

  const sources = normalizedParts.flatMap((p: any) => getSourceParts(p));

  const reasoningParts = normalizedParts
    .filter((p: any) => {
      if (p.type !== "reasoning") return false;
      if (isStreaming) return true;
      return getReasoningText(p).trim().length > 0;
    })
    .map((p: any, idx: number) => ({ ...p, originalIndex: idx }));

  const extractTitle = (text: string): { title: string; content: string } => {
    const boldMatch = text.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      const title = boldMatch[1];
      const content = text.replace(/\*\*(.+?)\*\*\s*\n?/, "").trim();
      return { title, content };
    }
    return { title: "Razonamiento", content: text };
  };

  const reasoningItems = reasoningParts
    .map((part: any, idx: number) => {
      const text = getReasoningText(part).trim();
      return {
        ...extractTitle(text),
        key: `${part.originalIndex ?? idx}:${text.length}:${getReasoningState(part)}`,
      };
    })
    .filter((item) => isStreaming || item.content.length > 0);
  const hasReasoningContent = isStreaming || reasoningItems.length > 0;
  const reasoningTitle = reasoningItems.length === 1
    ? reasoningItems[0]!.title
    : "Razonamiento";
  const renderedReasoningItems = reasoningItems.length > 0
    ? reasoningItems
    : [{ key: "streaming", title: "Razonamiento", content: "" }];

  const defaultUserContentChrome = "bg-primary text-primary-foreground shadow-sm";
  const userContentChrome =
    (classNames as AgentClassNames | undefined)?.message?.userContent ??
    defaultUserContentChrome;

  const renderAttachments = (parts: any[]) => {
    const attachments = parts
      .flatMap((part) => {
        const record = asRecord(part);
        if (!record) return [];
        if (record.type === "file") return [record];
        if (record.type !== "message") return [];

        const blocks = asRecord(record.content)?.blocks;
        return Array.isArray(blocks)
          ? blocks.filter((block) => asRecord(block)?.type === "file")
          : [];
      })
      .map((p: any) => ({
        filename: p.filename || "file",
        url:
          (typeof p.url === "string" ? p.url : "") ||
          p.providerMetadata?.instant?.downloadUrl,
        mediaType: p.mediaType,
      }))
      .filter((att) => typeof att.url === "string" && att.url.length > 0);

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
          className={cn(
            message.role === "user" ? userContentChrome : undefined,
            (classNames as AgentClassNames | undefined)?.message?.content,
          )}
        >
          <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((att: any, i: number) => (
              att.mediaType?.startsWith("image/") ? (
                <a
                  key={i}
                  href={att.url}
                  target="_blank"
                  rel="noopener"
                  className="block overflow-hidden rounded border bg-background/50 hover:bg-accent transition-colors"
                  title={att.filename}
                >
                  <img
                    alt={att.filename}
                    className="h-32 w-32 object-cover"
                    src={att.url}
                  />
                </a>
              ) : (
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
              )
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
          <details
            open={isCoTOpen}
            onToggle={(event) => setIsCoTOpen(event.currentTarget.open)}
            className={cn(
              "mb-3 border-l border-border pl-3",
              isStepSurface && "mb-2"
            )}
          >
            <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground">
              {reasoningTitle}
            </summary>
            <div className="mt-2 space-y-3">
              {renderedReasoningItems.map((item) => (
                <div
                  key={item.key}
                >
                  {renderedReasoningItems.length > 1 ? (
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      {item.title}
                    </div>
                  ) : null}
                  {item.content ? (
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {item.content}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null)}

      {normalizedParts.map((part: any, i: number) => {
        if (part.type === "reasoning" || part.type === "source" || part.type === "file") {
          return null;
        }

        const action = getActionPartInfo(part);
        if (action) {
          if (actionPresentation.skipIndexes.has(i)) return null;
          const actionView = actionPresentation.renderByIndex.get(i);
          return actionView ? renderActionView(actionView, i) : null;
        }

        const text = getPartText(part);

        if (text) {
          if (renderedCreateMessageTexts.has(text.trim())) return null;

          if (isStepSurface) {
            return (
              <div
                key={i}
                data-testid="message-part"
                className="text-sm leading-6 text-foreground"
              >
                <MessageResponse>{text}</MessageResponse>
              </div>
            );
          }

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
                      ? userContentChrome
                      : "bg-transparent pl-0 py-0",
                    (classNames as AgentClassNames | undefined)?.message
                      ?.content,
                  )}
                >
                  <MessageResponse>{text}</MessageResponse>
                </MessageContent>
              </Message>

              {message.role === "assistant" &&
                i === normalizedParts.length - 1 && (
                  <div className="ml-0 mt-1 flex gap-2">
                    <Button
                      size="icon"
                      className="h-7 w-7"
                      variant="ghost"
                      onClick={() => handleCopy(text)}
                      title="Copy"
                    >
                      <CopyIcon className="size-3" />
                    </Button>
                  </div>
                )}
            </Fragment>
          );
        }

        return null;
      })}

      {renderAttachments(normalizedParts)}
      {renderChannelButtons()}
      {renderChannelContent()}
    </Fragment>
  );
});

export { MessageParts };
