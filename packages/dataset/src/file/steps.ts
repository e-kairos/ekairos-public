import { getThreadRuntime } from "@ekairos/thread/runtime"

export async function readInstantFileStep(params: { env: any; fileId: string }): Promise<{
  url: string
  contentDisposition?: string
  contentBase64: string
}> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db

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

