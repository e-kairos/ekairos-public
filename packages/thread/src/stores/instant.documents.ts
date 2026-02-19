import type { ThreadItem } from "../thread.store.js"
import { parseAndStoreDocument } from "./instant.document-parser.js"

type FileUIPart = {
  type: "file"
  mediaType?: string
  filename?: string
  url?: string
  providerMetadata?: {
    instant?: {
      fileId?: string
      path?: string
      downloadUrl?: string
      size?: number
    }
  }
}

function isFilePart(part: any): part is FileUIPart {
  return Boolean(
    part &&
      typeof part === "object" &&
      (part.type === "file" || part?.providerMetadata?.instant),
  )
}

function formatAttachmentSummary(part: FileUIPart) {
  const instant = part?.providerMetadata?.instant ?? {}

  const fileId = typeof instant?.fileId === "string" ? instant.fileId : ""
  const filename = typeof part?.filename === "string" ? part.filename : ""
  const mediaType = typeof part?.mediaType === "string" ? part.mediaType : ""

  // Keep it compact; no URLs (can be signed/sensitive).
  return `fileId="${fileId}" filename="${filename}" mediaType="${mediaType}"`
}

export function coerceDocumentTextPages(
  documentRecord: any,
  opts?: { pageLabelPrefix?: string },
): string {
  const pages = documentRecord?.content?.pages
  if (!Array.isArray(pages) || pages.length === 0) return ""

  const prefix = opts?.pageLabelPrefix ?? "Page"
  return pages
    .map((p: any, idx: number) => {
      const text = typeof p?.text === "string" ? p.text : ""
      return `\n\n--- ${prefix} ${idx + 1} ---\n\n${text}`
    })
    .join("")
}

async function resolveInstantFileRecord(db: any, params: { fileId?: string; path?: string }) {
  const fileId = params.fileId ? String(params.fileId) : null
  const filePath = params.path ? String(params.path) : null

  if (!fileId && !filePath) return null

  if (fileId) {
    const q: any = await db.query({
      $files: { $: { where: { id: fileId as any }, limit: 1 }, document: {} },
    })
    return q?.$files?.[0] ?? null
  }

  const q: any = await db.query({
    $files: { $: { where: { path: filePath as any }, limit: 1 }, document: {} },
  })
  return q?.$files?.[0] ?? null
}

async function ensureDocumentParsedForFile(db: any, params: { fileRecord: any; part: any }) {
  const fileRecord = params.fileRecord
  const part = params.part

  let documentRecord: any = Array.isArray(fileRecord?.document)
    ? fileRecord.document?.[0]
    : fileRecord.document

  if (documentRecord?.id) return documentRecord

  const fileUrl = typeof fileRecord?.url === "string" ? fileRecord.url : ""
  if (!fileUrl.startsWith("http://") && !fileUrl.startsWith("https://")) {
    return null
  }

  const resp = await fetch(fileUrl)
  if (!resp.ok) throw new Error(`Failed to fetch file for parsing: HTTP ${resp.status}`)

  const buffer = Buffer.from(await resp.arrayBuffer())
  const name =
    (typeof part?.filename === "string" && part.filename) ||
    (typeof fileRecord?.path === "string" && fileRecord.path) ||
    "file"
  // NOTE: Do not invent fallback paths. If the file doesn't have a stable `path`,
  // we don't fabricate one.
  const path = typeof fileRecord?.path === "string" ? fileRecord.path : undefined

  const documentId = await parseAndStoreDocument(
    db as any,
    buffer,
    name,
    String(fileRecord.id),
  )

  const dq: any = await db.query({
    document_documents: { $: { where: { id: documentId as any }, limit: 1 }, file: {} },
  })
  documentRecord = dq?.document_documents?.[0] ?? null
  return documentRecord
}

export async function expandEventsWithInstantDocuments(params: {
  db: any
  events: ThreadItem[]
  /**
   * Hard limit to avoid huge model inputs. Defaults to 120k chars of extracted text.
   */
  maxChars?: number
  /**
   * Event type used for derived document text. Defaults to "output_text".
   */
  derivedEventType?: ThreadItem["type"]
}) {
  const db = params.db
  const maxChars = typeof params.maxChars === "number" ? params.maxChars : 120_000
  const derivedEventType = params.derivedEventType ?? "output_text"

  const out: ThreadItem[] = []

  for (const event of params.events) {
    const parts = (event as any)?.content?.parts
    if (!Array.isArray(parts) || parts.length === 0) {
      out.push(event)
      continue
    }

    const hadFileParts = parts.some((p: any) => isFilePart(p))
    if (hadFileParts) {
      // Do not forward file parts to the model (gateways may not support some media types).
      // The derived `document.parsed` event contains the extracted text.
      const filtered = parts.filter((p: any) => !isFilePart(p))
      const attachmentSummaries = parts
        .filter((p: any) => isFilePart(p))
        .map((p: any) => formatAttachmentSummary(p))
        .join("\n")

      const attachmentInfoText = attachmentSummaries
        ? `Attachment info:\n${attachmentSummaries}`
        : "Attachment info: (unavailable)"

      const sanitized: ThreadItem = {
        ...(event as any),
        content: {
          ...(event as any)?.content,
          parts: [
            ...filtered,
            {
              type: "text",
              text:
                "[Attachment omitted from model input. Parsed content will follow in a document.parsed event.]\n" +
                attachmentInfoText,
            },
          ],
        },
      }
      out.push(sanitized)
    } else {
      out.push(event)
    }

    for (const part of parts) {
      if (!isFilePart(part)) continue

      const instantMeta = (part as any)?.providerMetadata?.instant ?? {}
      const fileId = instantMeta?.fileId ? String(instantMeta.fileId) : undefined
      const filePath = instantMeta?.path ? String(instantMeta.path) : undefined

      const fileRecord = await resolveInstantFileRecord(db, { fileId, path: filePath })
      if (!fileRecord?.id) continue

      const documentRecord = await ensureDocumentParsedForFile(db, { fileRecord, part })
      const pageText = coerceDocumentTextPages(documentRecord)
      if (!pageText) continue

      const clipped =
        pageText.length > maxChars
          ? `${pageText.slice(0, maxChars)}\n\n[truncated: maxChars=${maxChars}]`
          : pageText

      const derivedAttachmentInfo = `Attachment info:\n${formatAttachmentSummary(part)}`
      const derived: ThreadItem = {
        id: `derived:${event.id}:${String(fileRecord.id)}`,
        type: derivedEventType,
        channel: (event as any).channel ?? "web",
        createdAt: new Date().toISOString() as any,
        content: {
          parts: [
            {
              type: "text",
              text:
                "Parsed document available.\n" +
                derivedAttachmentInfo +
                "\nProvider: llamacloud",
            },
            { type: "text", text: `Document transcription:${clipped}` },
          ],
        } as any,
      }

      out.push(derived)
    }
  }

  return out
}



