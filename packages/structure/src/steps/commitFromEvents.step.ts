import { getThreadRuntime } from "../runtime.js"

type ToolCompletePart = { type: "tool-complete"; state: "output-available"; output?: unknown }

function isToolCompletePart(value: unknown): value is ToolCompletePart {
  if (!value || typeof value !== "object") return false
  const v = value as { type?: unknown; state?: unknown }
  return v.type === "tool-complete" && v.state === "output-available"
}

function findLatestCompleteToolOutput(events: unknown[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const parts = (events[i] as { content?: { parts?: unknown } })?.content?.parts
    if (!Array.isArray(parts)) continue
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]
      if (!isToolCompletePart(p)) continue
      return p.output
    }
  }
  return null
}

export async function structureCommitFromEventsStep(params: {
  env: any
  structureId: string
}): Promise<{ ok: true; data: { committed: boolean } } | { ok: false; error: string }> {
  "use step"
  const contextKey = `structure:${params.structureId}`

  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime")
    const runtime = (await getThreadRuntime(params.env)) as {
      store: { getItems(p: { key: string }): Promise<unknown[]>; getContext(p: { key: string }): Promise<{ id: string; content?: unknown } | null>; updateContextContent(p: { key: string }, c: unknown): Promise<unknown> }
      db: { transact(tx: unknown): Promise<unknown>; tx: { thread_contexts: Record<string, { link(d: { structure_output_file: string }): unknown }> } }
    }
    const store = runtime.store
    const db = runtime.db

    const events = await store.getItems({ key: contextKey })
    const output = findLatestCompleteToolOutput(events ?? [])
    const out = output as { success?: boolean; result?: unknown; fileId?: string; storagePath?: string; validRows?: unknown } | null
    if (!out || out.success !== true) return { ok: true, data: { committed: false } }

    const ctx = await store.getContext({ key: contextKey })
    const prevContent = ((ctx?.content ?? {}) as Record<string, unknown>) ?? {}
    const prevStructure = (prevContent?.structure ?? {}) as Record<string, unknown>

    const nextStructure: Record<string, unknown> = {
      ...prevStructure,
      kind: "ekairos.structure",
      version: 1,
      structureId: params.structureId,
      updatedAt: Date.now(),
      state: "completed",
    }

    // Object completion
    if (out.result !== undefined) {
      nextStructure.outputs = {
        ...(((prevStructure as any)?.outputs ?? {}) as Record<string, unknown>),
        object: { value: out.result },
      } as unknown
    }

    // Rows completion
    if (out.fileId && out.storagePath) {
      nextStructure.metrics = {
        ...(((prevStructure as any)?.metrics ?? {}) as Record<string, unknown>),
        calculatedTotalRows:
          typeof out.validRows === "number" ? out.validRows : (prevStructure as any)?.metrics?.calculatedTotalRows,
        actualGeneratedRowCount:
          typeof out.validRows === "number" ? out.validRows : (prevStructure as any)?.metrics?.actualGeneratedRowCount,
      } as unknown
      nextStructure.outputs = {
        ...(((prevStructure as any)?.outputs ?? {}) as Record<string, unknown>),
        rows: {
          format: "jsonl",
          fileId: out.fileId,
          storagePath: out.storagePath,
          rowCount: typeof out.validRows === "number" ? out.validRows : undefined,
        },
      } as unknown

      // Link output file to context (domain-prefixed link)
      const ctxId = ctx?.id
      if (!ctxId) return { ok: false, error: "Context not found" }
      await db.transact(db.tx.thread_contexts[ctxId].link({ structure_output_file: out.fileId }))
    }

    await store.updateContextContent({ key: contextKey }, { ...prevContent, structure: nextStructure })

    return { ok: true, data: { committed: true } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}


