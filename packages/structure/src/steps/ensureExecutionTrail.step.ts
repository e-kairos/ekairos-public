type EnsureExecutionTrailParams = {
  env: any
  contextKey: string
  datasetId: string
  output: "rows" | "object"
  requestItemId: string
  status: "success" | "failed"
  error?: unknown
}

function createTraceItemId(seed: string) {
  let hashA = 2166136261
  let hashB = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i)
    hashA ^= code
    hashA = Math.imul(hashA, 16777619)
    hashB ^= code + (i % 13)
    hashB = Math.imul(hashB, 16777619)
  }
  const partA = (hashA >>> 0).toString(16).padStart(8, "0")
  const partB = (hashB >>> 0).toString(16).padStart(8, "0")
  const hex = `${partA}${partB}${partA}${partB}`
  const chars = hex.slice(0, 32).split("")
  chars[12] = "4"
  const variant = parseInt(chars[16], 16)
  chars[16] = ((variant & 0x3) | 0x8).toString(16)
  const normalized = chars.join("")
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`
}

function toSerializableError(error: unknown) {
  if (!error) return undefined
  if (typeof error === "string") return error
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return String(error)
}

export async function ensureExecutionTrailStep(
  params: EnsureExecutionTrailParams,
): Promise<void> {
  "use step"

  const { getContextRuntime } = await import("@ekairos/events/runtime")
  const runtime = (await getContextRuntime(params.env)) as any
  const store = runtime.store as any
  if (
    !store?.saveItem ||
    !store?.createExecution ||
    !store?.linkItemToExecution ||
    !store?.getItems
  ) {
    return
  }

  const items = await store.getItems({ key: params.contextKey })
  const hasRequest = items.some((item: any) => item?.id === params.requestItemId)
  let requestItemId = params.requestItemId

  if (!hasRequest) {
    const recreatedRequestItemId = createTraceItemId(
      `structure-trace:request:${params.contextKey}:${params.datasetId}:${params.requestItemId}`,
    )
    const requestItem = await store.saveItem(
      { key: params.contextKey },
      {
        id: recreatedRequestItemId,
        type: "input",
        channel: "web",
        createdAt: new Date().toISOString(),
        content: {
          parts: [{ type: "text", text: "[structure-trace] request (recreated)" }],
          structure_build: {
            datasetId: params.datasetId,
            status: "input",
          },
        },
      } as any,
    )
    if (!requestItem?.id) return
    requestItemId = requestItem.id
  }

  const outputItemId = createTraceItemId(
    `structure-trace:output:${params.contextKey}:${params.datasetId}:${params.status}:${params.output}`,
  )
  const outputItem = await store.saveItem(
    { key: params.contextKey },
    {
      id: outputItemId,
      type: "output",
      channel: "web",
      createdAt: new Date().toISOString(),
      content: {
        parts: [
          { type: "text", text: `structure:${params.datasetId} ${params.status}` },
        ],
        structure_build: {
          datasetId: params.datasetId,
          status: params.status,
          output: params.output,
          orgId: params.env?.orgId,
          error: toSerializableError(params.error),
        },
      },
    } as any,
  )
  if (!outputItem?.id) return

  const context = await store.getContext?.({ key: params.contextKey })
  if (context?.status === "closed" && store?.updateContextStatus) {
    await store.updateContextStatus({ key: params.contextKey }, "open_idle")
  }

  const execution = await store.createExecution(
    { key: params.contextKey },
    requestItemId,
    outputItem.id,
  )
  await store.linkItemToExecution({
    itemId: requestItemId,
    executionId: execution.id,
  })
  await store.linkItemToExecution({
    itemId: outputItem.id,
    executionId: execution.id,
  })
  if (store?.completeExecution) {
    await store.completeExecution(
      { key: params.contextKey },
      execution.id,
      "completed",
    )
  }
}
