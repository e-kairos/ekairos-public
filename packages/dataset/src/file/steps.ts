async function getRuntimeDb(runtime: any) {
  if (!runtime) {
    throw new Error("Dataset file step requires runtime.")
  }

  const db = runtime.db
  return typeof db === "function" ? await db.call(runtime) : db
}

export async function readInstantFileStep(params: { runtime: any; fileId: string }): Promise<{
  url: string
  contentDisposition?: string
  contentBase64: string
}> {
  "use step"
  const db = await getRuntimeDb(params.runtime)

  const fileQuery: any = await db.query({
    $files: { $: { where: { id: params.fileId } as any, limit: 1 } },
  })
  const fileRecord = fileQuery.$files?.[0]
  if (!fileRecord || !fileRecord.url) {
    throw new Error("File not found")
  }

  const fileBuffer = await fetch(fileRecord.url).then((r) => r.arrayBuffer())
  const contentDisposition = fileRecord["content-disposition"]

  return {
    url: fileRecord.url,
    contentDisposition,
    contentBase64: Buffer.from(fileBuffer).toString("base64"),
  }
}

