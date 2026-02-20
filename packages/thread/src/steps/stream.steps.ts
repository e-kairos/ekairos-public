import type { UIMessageChunk } from "ai"

import type { ThreadStreamEvent } from "../thread.stream.js"

export async function writeThreadEvents(params: {
  events: ThreadStreamEvent[]
  writable?: WritableStream<UIMessageChunk>
}) {
  "use step"
  const writable = params.writable
  if (!writable || !params.events.length) return
  const writer = writable.getWriter()
  try {
    for (const event of params.events) {
      await writer.write({
        type: `data-${String(event.type)}`,
        data: event,
      } as any)
    }
  } finally {
    writer.releaseLock()
  }
}

export async function closeThreadStream(params: {
  preventClose?: boolean
  sendFinish?: boolean
  writable?: WritableStream<UIMessageChunk>
}) {
  "use step"
  const sendFinish = params.sendFinish ?? true
  const preventClose = params.preventClose ?? false
  const writable = params.writable
  if (!writable) return

  if (sendFinish) {
    const writer = writable.getWriter()
    try {
      await writer.write({ type: "finish" } as any)
    } finally {
      writer.releaseLock()
    }
  }

  if (!preventClose) {
    await writable.close()
  }
}
