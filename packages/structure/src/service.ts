import { SchemaOf } from "@ekairos/domain"
import { structureDomain } from "./schema.js"

export type ServiceResult<T = any> = { ok: true; data: T } | { ok: false; error: string }

type StructureSchemaType = SchemaOf<typeof structureDomain>

/**
 * Back-compat helper for reading structure outputs outside the workflow runtime.
 *
 * IMPORTANT: The source of truth is `thread_contexts` (Story context) keyed by `structure:<id>`.
 */
export class DatasetService {
  private readonly db: any

  constructor(db: any) {
    this.db = db
  }

  private contextKey(structureId: string) {
    return `structure:${structureId}`
  }

  async getDatasetById(datasetId: string): Promise<ServiceResult<any>> {
    try {
      const key = this.contextKey(datasetId)
      const res: any = await (this.db as any).query({
        thread_contexts: {
          $: { where: { key } as any, limit: 1 },
          structure_output_file: {},
        } as any,
      } as any)
      const ctx = res.thread_contexts?.[0]
      if (!ctx) return { ok: false, error: "Context not found" }
      return { ok: true, data: ctx }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async getFileById(fileId: string): Promise<any> {
    const fileQuery: any = await (this.db as any).query({
      $files: {
        $: {
          where: { id: fileId } as any,
          limit: 1,
        },
      },
    } as any)
    return fileQuery
  }

  async readRecordsFromFile(datasetId: string): Promise<ServiceResult<AsyncGenerator<any, void, unknown>>> {
    try {
      const key = this.contextKey(datasetId)
      const res: any = await (this.db as any).query({
        thread_contexts: {
          $: { where: { key } as any, limit: 1 },
          structure_output_file: {},
        } as any,
      } as any)

      const ctx = res.thread_contexts?.[0]
      const linked = Array.isArray(ctx?.structure_output_file) ? ctx.structure_output_file[0] : ctx?.structure_output_file
      const url = linked?.url
      if (!url) return { ok: false, error: "Rows output file not found" }

      async function* createGenerator(fileUrl: string): AsyncGenerator<any, void, unknown> {
        // NOTE:
        // We intentionally download the file fully (with retry/timeout) before yielding.
        // This avoids partial processing + duplicates when network streams abort mid-way
        // (e.g. undici `TypeError: terminated`).
        const text = await fetchTextWithRetry(fileUrl, { attempts: 4, timeoutMs: 90_000 })

        // Parse JSONL (one JSON object per line)
        const lines = text.split("\n")
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            yield JSON.parse(trimmed)
          } catch {
            // skip invalid line
          }
        }
      }

      return { ok: true, data: createGenerator(url) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  /**
   * Back-compat: create a new structure context keyed by `structure:<id>`.
   * This is not used by the primary `structure()` API, which creates contexts via Story runtime.
   */
  async createDataset(params: { id?: string }): Promise<ServiceResult<{ datasetId: string }>> {
    try {
      const datasetId = params.id ?? createUuidV4()
      const key = this.contextKey(datasetId)

      const existing: any = await (this.db as any).query({
        thread_contexts: { $: { where: { key } as any, limit: 1 } },
      } as any)
      const ctx = existing.thread_contexts?.[0]
      if (ctx) return { ok: true, data: { datasetId } }

      await this.db.transact([
        this.db.tx.thread_contexts[createUuidV4()].create({
          createdAt: new Date(),
          content: {},
          key,
          status: "open",
        } as any),
      ])

      return { ok: true, data: { datasetId } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async uploadDatasetOutputFile(params: {
    datasetId: string
    fileBuffer: Buffer
  }): Promise<ServiceResult<{ fileId: string; storagePath: string }>> {
    try {
      const storagePath = `/structure/${params.datasetId}/output.jsonl`
      const uploadResult = await this.db.storage.uploadFile(storagePath, params.fileBuffer, {
        contentType: "application/x-ndjson",
        contentDisposition: "output.jsonl",
      })
      const fileId = uploadResult?.data?.id
      if (!fileId) return { ok: false, error: "Failed to upload file to storage" }

      const linkResult = await this.linkFileToDataset({ datasetId: params.datasetId, fileId })
      if (!linkResult.ok) return linkResult

      return { ok: true, data: { fileId, storagePath } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async linkFileToDataset(params: { datasetId: string; fileId: string }): Promise<ServiceResult<void>> {
    try {
      const key = this.contextKey(params.datasetId)
      const res: any = await (this.db as any).query({
        thread_contexts: { $: { where: { key } as any, limit: 1 } },
      } as any)
      const ctx = res?.thread_contexts?.[0]
      const ctxId = ctx?.id
      if (!ctxId) return { ok: false, error: "Context not found" }

      await this.db.transact([this.db.tx.thread_contexts[ctxId].link({ structure_output_file: params.fileId })])
      return { ok: true, data: undefined }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }
}

function createUuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchTextWithRetry(
  url: string,
  opts: { attempts: number; timeoutMs: number },
): Promise<string> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Failed to download rows output file (HTTP ${res.status})`)
      }
      return await res.text()
    } catch (e) {
      lastError = e

      // Backoff: 250ms, 500ms, 1000ms...
      if (attempt < opts.attempts) {
        await sleep(250 * Math.pow(2, attempt - 1))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(message || "Failed to download rows output file")
}

