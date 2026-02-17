function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // strip ```json fences
  const fenceStart = trimmed.startsWith("```") ? trimmed : ""
  if (fenceStart) {
    const withoutFirst = trimmed.replace(/^```[a-zA-Z]*\s*/i, "")
    const withoutLast = withoutFirst.replace(/\s*```$/i, "")
    try {
      return JSON.parse(withoutLast.trim())
    } catch {
      // fall through
    }
  }

  // direct parse
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }

  // best-effort: extract first {...} block
  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) return null
  const candidate = trimmed.slice(first, last + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export async function persistObjectResultFromStoryStep(params: { env: any; datasetId: string }): Promise<{ ok: boolean }> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = (await getThreadRuntime(params.env)) as any
  const store = runtime.store
  const contextKey = `structure:${params.datasetId}`
  const events = await store.getEvents({ key: contextKey })

  const { structurePatchContextContentStep, structureGetContextStep } = await import("../dataset/steps.js")
  const ctxResult = await structureGetContextStep({ env: params.env, contextKey })
  const existingContent = ctxResult.ok ? ((ctxResult.data?.content ?? {}) as any) : ({} as any)

  for (let i = events.length - 1; i >= 0; i--) {
    const e: any = events[i]
    const parts = e?.content?.parts
    if (!Array.isArray(parts)) continue
    const text = parts
      .map((p: any) => (p?.type === "text" ? String(p.text ?? "") : ""))
      .join("\n")
      .trim()
    const obj = extractJsonObject(text)
    if (obj) {
      const patchResult = await structurePatchContextContentStep({
        env: params.env,
        contextKey,
        patch: {
          structure: {
            kind: "ekairos.structure",
            version: 1,
            structureId: params.datasetId,
            updatedAt: Date.now(),
            state: "completed",
            outputs: {
              ...(existingContent?.structure?.outputs ?? {}),
              object: { value: obj },
            },
          },
        } as any,
      })
      if (!(patchResult as any)?.ok) {
        const err = (patchResult as any)?.error ?? "Failed to persist object result"
        throw new Error(err)
      }
      return { ok: true }
    }
  }

  return { ok: false }
}

