export async function readInstantFileStep(params: {
  env: any
  fileId: string
}): Promise<{ contentBase64: string; contentDisposition?: string }> {
  "use step"
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const runtime = (await getThreadRuntime(params.env)) as { db: unknown }
  const db = runtime.db
  const { DatasetService } = await import("../service.js")
  const service = new DatasetService(db)
  const file = await service.getFileById(params.fileId)
  const fileRow = (file as { $files?: Array<{ url?: string } & Record<string, unknown>> })?.$files?.[0]
  const url = fileRow?.url
  if (!url) {
    throw new Error("File not found or URL missing")
  }
  const fileBuffer = await fetch(url).then((response) => response.arrayBuffer())
  return {
    contentBase64: Buffer.from(fileBuffer).toString("base64"),
    contentDisposition: (fileRow as Record<string, unknown>)["content-disposition"] as string | undefined,
  }
}

