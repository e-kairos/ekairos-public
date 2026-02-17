import "../polyfills/dom-events.js";
import { id } from "@instantdb/admin";

const LLAMA_CLOUD_BASE_URL = "https://api.cloud.llamaindex.ai/api/v1";

interface DocumentPage {
  id: string;
  text: string;
}

interface LlamaParseUploadResponse {
  id: string;
  status: string;
}

interface LlamaParseStatusResponse {
  status: string;
}

interface LlamaParseResultResponse {
  markdown?: string;
  pages?: Array<{ page: number; text: string }>;
}

function safeErrorJson(error: unknown) {
  const seen = new WeakSet<object>()
  const redactKey = (k: string) =>
    /token|authorization|cookie|secret|api[_-]?key|password/i.test(k)

  const err: any = error as any
  const payload = {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    body: err?.body,
    data: err?.data,
    stack: err?.stack,
  }

  try {
    return JSON.stringify(payload, (k, v) => {
      if (redactKey(k)) return "[redacted]"
      if (typeof v === "string" && v.length > 5_000) return "[truncated-string]"
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]"
        seen.add(v)
      }
      return v
    })
  } catch {
    return JSON.stringify({ message: String(err?.message ?? "error") })
  }
}

async function probeInstantDocumentSchema(db: any) {
  // Best-effort probes to pinpoint missing schema pieces WITHOUT logging dynamic payloads.
  // Each line is a static string.
  try {
    await db.query({ document_documents: { $: { limit: 1 } } })
  } catch {
    console.error("Instant schema probe: document_documents entity query failed")
  }

  try {
    await db.query({ document_documents: { $: { limit: 1 }, file: {} } })
  } catch {
    console.error("Instant schema probe: document_documents.file link query failed")
  }

  try {
    await db.query({ $files: { $: { limit: 1 } } })
  } catch {
    console.error("Instant schema probe: $files entity query failed")
  }

  try {
    await db.query({ $files: { $: { limit: 1 }, document: {} } })
  } catch {
    console.error("Instant schema probe: $files.document link query failed")
  }
}

async function uploadToLlamaCloud(buffer: Buffer, fileName: string): Promise<string> {
  const formData = new FormData();
  const uint8Array = new Uint8Array(buffer);
  const blob = new Blob([uint8Array], { type: "application/pdf" });
  formData.append("file", blob, fileName);
  formData.append("parse_mode", "parse_page_with_llm");
  formData.append("high_res_ocr", "true");
  formData.append("adaptive_long_table", "true");
  formData.append("outlined_table_extraction", "true");
  formData.append("output_tables_as_HTML", "true");

  let response: Response
  try {
    response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
      },
      body: formData,
    });
  } catch (error) {
    console.error("LlamaCloud: upload fetch threw", safeErrorJson(error))
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LlamaCloud upload failed: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as unknown as LlamaParseUploadResponse;
  return result.id;
}

async function getJobStatus(jobId: string): Promise<LlamaParseStatusResponse> {
  let response: Response
  try {
    response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/job/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
      },
    });
  } catch (error) {
    console.error("LlamaCloud: status fetch threw", safeErrorJson(error))
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LlamaCloud status fetch failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as unknown as LlamaParseStatusResponse;
}

async function getParseResult(jobId: string): Promise<LlamaParseResultResponse> {
  let response: Response
  try {
    response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/job/${jobId}/result/markdown`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
      },
    });
  } catch (error) {
    console.error("LlamaCloud: result fetch threw", safeErrorJson(error))
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LlamaCloud result fetch failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as unknown as LlamaParseResultResponse;
}

async function waitForProcessing(jobId: string, maxAttempts: number = 60): Promise<LlamaParseResultResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResponse = await getJobStatus(jobId);

    if (statusResponse.status === "SUCCESS" || statusResponse.status === "COMPLETED") {
      return await getParseResult(jobId);
    }

    if (statusResponse.status === "ERROR" || statusResponse.status === "FAILED") {
      throw new Error(`LlamaCloud processing failed with status: ${statusResponse.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("LlamaCloud processing timeout");
}

/**
 * Parses a document with LlamaParse and stores it in InstantDB (document_documents + link to file).
 * Returns the created documentId.
 */
export async function parseAndStoreDocument(
  db: any,
  buffer: Buffer,
  fileName: string,
  fileId: string,
): Promise<string> {
  let existingDocument: any
  try {
    existingDocument = await db.query({
      document_documents: {
        $: {
          where: { "file.id": fileId },
        },
        file: {},
      },
    });
  } catch (error) {
    console.error("parseAndStoreDocument: query existing failed", safeErrorJson(error))
    throw error
  }

  if (existingDocument.document_documents && existingDocument.document_documents.length > 0) {
    return existingDocument.document_documents[0].id;
  }

  const jobId = await uploadToLlamaCloud(buffer, fileName);
  const result = await waitForProcessing(jobId);

  const pages: DocumentPage[] = [];

  if (result.markdown) {
    pages.push({
      id: id(),
      text: result.markdown,
    });
  }

  if (result.pages && result.pages.length > 0) {
    for (const page of result.pages) {
      pages.push({
        id: id(),
        text: page.text,
      });
    }
  }

  if (pages.length === 0) {
    throw new Error("No content extracted from document");
  }

  const documentId = id();
  try {
    await db.transact([
      db.tx.document_documents[documentId].update({
        content: { pages },
        name: fileName,
        mimeType: "application/pdf",
        createdAt: new Date(),
      }),
      db.tx.document_documents[documentId].link({
        file: fileId,
      }),
    ]);
  } catch (error) {
    console.error("parseAndStoreDocument: transact failed", safeErrorJson(error))
    // Diagnose missing schema attributes/links (static logs only).
    await probeInstantDocumentSchema(db)
    throw error
  }

  return documentId;
}





