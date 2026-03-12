type EnsureExecutionTrailParams = {
  env: any
  contextKey: string
  datasetId: string
  output: "rows" | "object"
  requestItemId: string
  status: "success" | "failed"
  error?: unknown
}

export async function ensureExecutionTrailStep(
  params: EnsureExecutionTrailParams,
): Promise<void> {
  "use step"

  const { getThreadRuntime } = await import("@ekairos/events/runtime")
  const runtime = (await getThreadRuntime(params.env)) as any
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
    const requestItem = await store.saveItem(
      { key: params.contextKey },
      {
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

  const outputItem = await store.saveItem(
    { key: params.contextKey },
    {
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
          error: params.error ? String(params.error) : undefined,
        },
      },
    } as any,
  )
  if (!outputItem?.id) return

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
}
