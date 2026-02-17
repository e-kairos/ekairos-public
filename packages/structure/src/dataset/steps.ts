import type { ThreadRuntime } from "@ekairos/thread/runtime"

export type StructureContextContent = {
  /**
   * IMPORTANT:
   * Story engine persists its own runtime state into `context.content`.
   * To avoid clobbering, all structure metadata is namespaced under `structure`.
   */
  structure?: {
    kind?: "ekairos.structure"
    version?: number
    structureId?: string
    orgId?: string
    createdAt?: number
    updatedAt?: number
    mode?: "auto" | "schema"
    output?: "rows" | "object"
    instructions?: string
    sources?: any[]
    outputSchema?: { title?: string; description?: string; schema: any }
    state?: string
    metrics?: { calculatedTotalRows?: number; actualGeneratedRowCount?: number }
    outputs?: {
      rows?: { format: "jsonl"; fileId: string; storagePath: string; rowCount?: number }
      object?: { value: any }
    }
    error?: { message: string }
  }
}

export async function structureGetOrCreateContextStep(params: {
  env: any
  contextKey: string
}): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const ctx = await runtime.store.getOrCreateContext({ key: params.contextKey })
    return { ok: true, data: ctx }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureGetContextStep(params: {
  env: any
  contextKey: string
}): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const ctx = await runtime.store.getContext({ key: params.contextKey })
    if (!ctx) return { ok: false, error: "Context not found" }
    return { ok: true, data: ctx }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureUpdateContextContentStep(params: {
  env: any
  contextKey: string
  content: StructureContextContent
}): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const updated = await runtime.store.updateContextContent({ key: params.contextKey }, params.content)
    return { ok: true, data: updated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structurePatchContextContentStep(params: {
  env: any
  contextKey: string
  patch: Partial<StructureContextContent>
}): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const existing = await runtime.store.getOrCreateContext({ key: params.contextKey })
    const existingContent = (existing?.content ?? {}) as Record<string, unknown>
    const existingStructure = (existingContent?.structure ?? {}) as Record<string, unknown>
    const patchStructure = ((params.patch as StructureContextContent)?.structure ?? {}) as Record<string, unknown>

    const next = {
      ...existingContent,
      ...params.patch,
      structure: { ...existingStructure, ...patchStructure },
    }
    const updated = await runtime.store.updateContextContent({ key: params.contextKey }, next as any)
    return { ok: true, data: updated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureUploadRowsOutputJsonlStep(params: {
  env: any
  structureId: string
  contentBase64: string
}): Promise<{ ok: true; data: { fileId: string; storagePath: string } } | { ok: false; error: string }> {
  "use step"
  const startedAt = Date.now()
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const db = runtime.db
    const storagePath = `/structure/${params.structureId}/output.jsonl`
    const fileBuffer = Buffer.from(params.contentBase64 ?? "", "base64")
    const uploadResult = await db.storage.uploadFile(storagePath, fileBuffer, {
      contentType: "application/x-ndjson",
      contentDisposition: "output.jsonl",
    })
    const fileId = uploadResult?.data?.id
    if (!fileId) return { ok: false, error: "Failed to upload file to storage" }
    console.log(
      `[structure:upload-jsonl] structureId=${params.structureId} bytes=${fileBuffer.byteLength} elapsedMs=${Date.now() - startedAt}`,
    )
    return { ok: true, data: { fileId, storagePath } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureLinkRowsOutputFileToContextStep(params: {
  env: any
  contextKey: string
  fileId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  "use step"
  const startedAt = Date.now()
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const store = runtime.store
    const db = runtime.db
    const ctx = await store.getOrCreateContext({ key: params.contextKey })
    const ctxId = ctx?.id
    if (!ctxId) return { ok: false, error: "Context not found" }

    await db.transact([db.tx.thread_contexts[ctxId].link({ structure_output_file: params.fileId })])
    console.log(
      `[structure:link-jsonl] contextKey=${params.contextKey} fileId=${params.fileId} elapsedMs=${Date.now() - startedAt}`,
    )
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureUnlinkRowsOutputFileFromContextStep(params: {
  env: any
  contextKey: string
  fileId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const store = runtime.store
    const db = runtime.db
    const ctx = await store.getOrCreateContext({ key: params.contextKey })
    const ctxId = ctx?.id
    if (!ctxId) return { ok: false, error: "Context not found" }

    await db.transact([db.tx.thread_contexts[ctxId].unlink({ structure_output_file: params.fileId })])
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureGetContextWithRowsOutputFileStep(params: {
  env: any
  contextKey: string
}): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  "use step"
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const db = runtime.db
    const query = (await db.query({
      thread_contexts: {
        $: { where: { key: params.contextKey }, limit: 1 },
        structure_output_file: {},
      },
    })) as any
    const row = query.thread_contexts?.[0]
    if (!row) return { ok: false, error: "Context not found" }
    return { ok: true, data: row }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export async function structureReadRowsOutputJsonlStep(params: {
  env: any
  structureId: string
}): Promise<{ ok: true; data: { contentBase64: string } } | { ok: false; error: string }> {
  "use step"
  const startedAt = Date.now()
  try {
    const contextKey = `structure:${params.structureId}`
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime: ThreadRuntime = await getThreadRuntime(params.env)
    const db = runtime.db
    const query = (await db.query({
      thread_contexts: {
        $: { where: { key: contextKey }, limit: 1 },
        structure_output_file: {},
      },
    })) as any
    const ctx = query.thread_contexts?.[0]
    if (!ctx) return { ok: false, error: "Context not found" }
    const linked = Array.isArray(ctx?.structure_output_file) ? ctx.structure_output_file[0] : ctx.structure_output_file
    const url = linked?.url
    if (!url) return { ok: false, error: "Rows output file not found" }

    const fileBuffer = await fetchArrayBufferWithRetry(url, { attempts: 4, timeoutMs: 90_000 })
    console.log(
      `[structure:read-jsonl] structureId=${params.structureId} bytes=${fileBuffer.byteLength} elapsedMs=${Date.now() - startedAt}`,
    )
    return { ok: true, data: { contentBase64: Buffer.from(fileBuffer).toString("base64") } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchArrayBufferWithRetry(
  url: string,
  opts: { attempts: number; timeoutMs: number },
): Promise<ArrayBuffer> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Failed to download rows output file (HTTP ${res.status})`)
      }
      return await res.arrayBuffer()
    } catch (e) {
      lastError = e
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

