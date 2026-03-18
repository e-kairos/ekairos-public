import { randomUUID } from "node:crypto"

type StreamStoreEntry = {
  clientId: string
  chunks: string[]
}

export function attachMockInstantStreams(db: any) {
  if (db?.streams?.createWriteStream && db?.streams?.createReadStream) {
    return db
  }

  const streamsById = new Map<string, StreamStoreEntry>()
  const streamIdByClientId = new Map<string, string>()

  db.streams = {
    createWriteStream(params: { clientId?: string }) {
      const clientId = String(params?.clientId ?? `client:${randomUUID()}`)
      const streamId = randomUUID()
      const entry: StreamStoreEntry = {
        clientId,
        chunks: [],
      }
      streamsById.set(streamId, entry)
      streamIdByClientId.set(clientId, streamId)

      return {
        getWriter() {
          return {
            async write(chunk: unknown) {
              entry.chunks.push(typeof chunk === "string" ? chunk : String(chunk ?? ""))
            },
            async close() {
              // no-op
            },
            async abort() {
              // no-op
            },
          }
        },
        async streamId() {
          return streamId
        },
      }
    },

    createReadStream(params: { clientId?: string; streamId?: string; byteOffset?: number }) {
      const resolvedStreamId =
        String(params?.streamId ?? "").trim() ||
        streamIdByClientId.get(String(params?.clientId ?? "").trim()) ||
        ""
      const entry = streamsById.get(resolvedStreamId)
      const byteOffset = Math.max(0, Number(params?.byteOffset ?? 0))
      const encoded = entry ? entry.chunks.join("") : ""
      const sliced = encoded.slice(byteOffset)

      return {
        async *[Symbol.asyncIterator]() {
          if (!sliced) return
          yield sliced
        },
      }
    },
  }

  return db
}
