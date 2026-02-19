"use client";

import React, { memo, useCallback, useMemo, useState } from "react";
import { id } from "@instantdb/react";
import { Prompt } from "@/components/ekairos/prompt/prompt";
import type { PromptAttachment } from "@/components/ekairos/prompt/prompt-file-chip";
import { useOrgDb } from "@/lib/org-db-context";

import type { ThreadValue } from "@/components/ekairos/thread/context";

type FileUIPart = {
  type: "file";
  url?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: any;
};

type ChatAttachment = PromptAttachment & {
  filePart?: FileUIPart;
  path?: string;
  fileId?: string;
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / Math.pow(1024, exponent);
  return (
    (exponent === 0
      ? Math.round(value).toString()
      : value.toFixed(1).replace(/\.0$/, "")) +
    " " +
    units[exponent]
  );
}

type PromptBarProps = {
  thread: ThreadValue;
};

const PromptBarInner = memo(function PromptBarInner({ thread }: PromptBarProps) {
  const { db } = useOrgDb();
  const { append, contextId, contextStatus, sendStatus } = thread;
  const isDebugEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("ekairos:debug") === "1";
    } catch {
      return false;
    }
  }, []);

  const [input, setInput] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [reasoningLevel, setReasoningLevel] = useState<
    "off" | "low" | "medium" | "high"
  >("low");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const isUploading = useMemo(
    () => attachments.some((att) => att.status === "uploading"),
    [attachments]
  );
  const fileParts = useMemo(
    () =>
      attachments
        .filter((att) => att.status === "done" && att.filePart)
        .map((att) => att.filePart as FileUIPart),
    [attachments]
  );

  const uploadAttachment = useCallback(
    async (file: File, attachmentId: string) => {
      try {
        if (!db) throw new Error("db not ready");

        const contextSegment = contextId ?? "unassigned";
        const sanitizedName = sanitizeFileName(file.name || "file");
        const storagePath = `/agent/${contextSegment}/${Date.now()}-${sanitizedName}`;

        const uploadResult = await db.storage.uploadFile(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          contentDisposition: file.name,
        });

        const uploadRecord =
          uploadResult && typeof uploadResult === "object"
            ? (uploadResult as Record<string, unknown>)
            : null;
        const uploadData =
          uploadRecord && "data" in uploadRecord
            ? (uploadRecord.data as unknown)
            : uploadResult;
        const uploadDataRecord =
          uploadData && typeof uploadData === "object"
            ? (uploadData as Record<string, unknown>)
            : null;
        const fileId =
          uploadDataRecord && typeof uploadDataRecord.id === "string"
            ? uploadDataRecord.id
            : uploadDataRecord && typeof uploadDataRecord.id === "number"
              ? String(uploadDataRecord.id)
              : null;

        const downloadResult = await db.storage.getDownloadUrl(storagePath);
        const downloadUrl =
          typeof downloadResult === "string" ? downloadResult : downloadResult?.url;
        if (!downloadUrl) throw new Error("download url not returned");

        const filePart: FileUIPart = {
          type: "file",
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
          url: downloadUrl,
        };

        const providerMetadata: Record<string, unknown> = {
          path: storagePath,
          downloadUrl,
          size: file.size,
        };
        if (fileId) providerMetadata.fileId = fileId;
        if (Object.keys(providerMetadata).length > 0) {
          filePart.providerMetadata = { instant: providerMetadata };
        }

        setAttachments((prev) =>
          prev.map((att) => {
            if (att.id !== attachmentId) return att;
            return {
              ...att,
              status: "done",
              url: downloadUrl,
              type: file.type || att.type,
              filePart,
              fileId: fileId ?? att.fileId,
              path: storagePath,
            };
          })
        );
      } catch (error) {
        console.error("Error uploading attachment", error);
        setAttachments((prev) =>
          prev.map((att) =>
            att.id === attachmentId ? { ...att, status: "error" } : att
          )
        );
      }
    },
    [contextId, db]
  );

  const onFilesSelected = useCallback(
    (files: FileList) => {
      if (!files || files.length === 0) return;
      const entries = Array.from(files).filter(Boolean);
      if (entries.length === 0) return;

      const prepared = entries.map((file) => {
        const attachmentId = id();
        return {
          attachment: {
            id: attachmentId,
            name: file.name,
            status: "uploading" as const,
            type: file.type || undefined,
            size: formatBytes(file.size),
          },
          file,
        };
      });

      setAttachments((prev) => [...prev, ...prepared.map((p) => p.attachment)]);
      prepared.forEach(({ file, attachment }) =>
        void uploadAttachment(file, attachment.id)
      );
    },
    [uploadAttachment]
  );

  const onRemoveAttachment = useCallback(
    (attachmentId: string) =>
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId)),
    []
  );
  const onClearAttachments = useCallback(() => setAttachments([]), []);

  const readOnlyStatuses = new Set(["closed"]);
  const canSendMessage = !readOnlyStatuses.has(contextStatus);
  const isContextReadOnly = readOnlyStatuses.has(contextStatus);
  const isStreaming = contextStatus === "streaming";
  const isSubmitting = sendStatus === "submitting";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDebugEnabled) {
      // eslint-disable-next-line no-console
      console.debug("[ekairos:ui] submit:enter", {
        contextId,
        contextStatus,
        sendStatus,
        isUploading,
        canSendMessage,
        isSubmitting,
        isStreaming,
        inputLen: input?.length ?? 0,
      });
    }

    if (isUploading) {
      if (isDebugEnabled) console.debug("[ekairos:ui] blocked:uploading");
      return;
    }
    if (!canSendMessage) {
      if (isDebugEnabled) console.debug("[ekairos:ui] blocked:cannot-send", { contextStatus });
      return;
    }
    if (isSubmitting || isStreaming) {
      if (isDebugEnabled) console.debug("[ekairos:ui] blocked:busy", { isSubmitting, isStreaming });
      return;
    }

    const parts: any[] = [];
    const trimmed = input.trim();
    if (trimmed) parts.push({ type: "text", text: trimmed });
    for (const fp of fileParts) parts.push(fp);
    if (parts.length === 0) return;

    const previousInput = input;
    try {
      if (isDebugEnabled) console.debug("[ekairos:ui] submit:dispatch", { textPreview: trimmed.slice(0, 120) });
      // UX: clear immediately on submit, but restore if send fails so user doesn't lose text.
      setInput("");
      await append({ parts, webSearch, reasoningLevel });
      onClearAttachments();
    } catch (error) {
      // Restore input if it was cleared optimistically.
      setInput((current) => (current.length === 0 ? previousInput : current));
      console.error("Failed to send message", error);
    }
  };

  const promptStatus =
    isStreaming
      ? "streaming"
      : isSubmitting
        ? "submitted"
        : sendStatus === "error"
          ? "error"
          : "idle";
  const isBusy = isUploading || isSubmitting || isStreaming;
  const controlsDisabled = !canSendMessage || isBusy;
  const inputDisabled = isContextReadOnly;

  return (
    <Prompt
      value={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      webSearch={webSearch}
      onToggleWeb={() => setWebSearch(!webSearch)}
      reasoningLevel={reasoningLevel}
      onChangeReasoning={setReasoningLevel}
      status={promptStatus}
      onFilesSelected={onFilesSelected}
      isUploading={isUploading}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      disabled={controlsDisabled}
      inputDisabled={inputDisabled}
    />
  );
});

export function PromptBar(props: PromptBarProps) {
  return <PromptBarInner {...props} />;
}

