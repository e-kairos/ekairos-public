import { createHash, randomBytes, randomUUID } from "node:crypto"
import tls from "node:tls"

type PendingRead = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type WebSocketFrame = {
  fin: boolean
  opcode: number
  payload: Buffer
  consumed: number
}

type HotConnection = {
  id: string
  client: OpenAIResponsesWebSocket
  busy: boolean
  createdAtMs: number
  lastUsedAtMs: number
  requestCount: number
}

export type OpenAIResponsesWebSocketConnection = {
  webSocketUrl: string
  headers?: Record<string, string>
  handshakeTimeoutMs?: number
}

export type OpenAIResponsesStreamMetrics = {
  cacheKey: string
  connectionId: string
  connectionMode: "hot" | "cold"
  reusedConnection: boolean
  acquireMs: number
  handshakeMs: number
  providerEventCount: number
  firstProviderEventMs?: number
  firstTextDeltaMs?: number
  completedMs?: number
}

export type StreamOpenAIResponsesWebSocketParams = OpenAIResponsesWebSocketConnection & {
  request: Record<string, unknown>
  reuseHotConnection?: boolean
  idleTtlMs?: number
  maxHotConnections?: number
  requestTimeoutMs?: number
  onEvent: (event: unknown, metrics: OpenAIResponsesStreamMetrics) => Promise<void> | void
}

const HOT_CONNECTIONS = new Map<string, HotConnection[]>()

export function closeOpenAIResponsesWebSocketConnections() {
  for (const connections of HOT_CONNECTIONS.values()) {
    for (const entry of connections) {
      entry.client.close()
    }
  }
  HOT_CONNECTIONS.clear()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

function redactHeaders(headers: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /authorization|api[_-]?key|token|secret|cookie/i.test(key)
      ? "[redacted]"
      : value
  }
  return out
}

function createClientFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8")
  let header: Buffer

  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length])
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  const mask = randomBytes(4)
  const masked = Buffer.alloc(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % 4]!
  }
  return Buffer.concat([header, mask, masked])
}

function createPongFrame(payload: Buffer): Buffer {
  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.from([0x8a, 0x80 | payload.length])
  } else {
    header = Buffer.alloc(4)
    header[0] = 0x8a
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  }

  const mask = randomBytes(4)
  const masked = Buffer.alloc(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % 4]!
  }
  return Buffer.concat([header, mask, masked])
}

function parseFrame(buffer: Buffer): WebSocketFrame | null {
  if (buffer.length < 2) return null

  const fin = Boolean(buffer[0]! & 0x80)
  const opcode = buffer[0]! & 0x0f
  const masked = Boolean(buffer[1]! & 0x80)
  let payloadLength = buffer[1]! & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null
    const wideLength = buffer.readBigUInt64BE(offset)
    if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("OpenAIResponsesWebSocket: frame is too large.")
    }
    payloadLength = Number(wideLength)
    offset += 8
  }

  let mask: Buffer | null = null
  if (masked) {
    if (buffer.length < offset + 4) return null
    mask = buffer.subarray(offset, offset + 4)
    offset += 4
  }

  if (buffer.length < offset + payloadLength) return null

  let payload = buffer.subarray(offset, offset + payloadLength)
  if (mask) {
    const unmasked = Buffer.alloc(payloadLength)
    for (let index = 0; index < payloadLength; index += 1) {
      unmasked[index] = payload[index]! ^ mask[index % 4]!
    }
    payload = unmasked
  }

  return {
    fin,
    opcode,
    payload,
    consumed: offset + payloadLength,
  }
}

function normalizeRequestPath(url: URL) {
  return `${url.pathname}${url.search}`
}

function connectionCacheKey(params: OpenAIResponsesWebSocketConnection) {
  const headers = Object.entries(params.headers ?? {})
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b))

  return createHash("sha256")
    .update(`${params.webSocketUrl}\n${JSON.stringify(headers)}`)
    .digest("hex")
    .slice(0, 16)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function eventType(value: unknown): string {
  const record = asRecord(value)
  return typeof record.type === "string" ? record.type : ""
}

function isTerminalEvent(type: string) {
  return (
    type === "response.completed" ||
    type === "response.failed" ||
    type === "response.incomplete" ||
    type === "response.error" ||
    type === "error"
  )
}

function isFailureEvent(type: string) {
  return type === "response.failed" || type === "response.error" || type === "error"
}

function pruneConnections(cacheKey: string, idleTtlMs: number, maxHotConnections: number) {
  const now = Date.now()
  const connections = HOT_CONNECTIONS.get(cacheKey) ?? []
  const kept: HotConnection[] = []

  for (const entry of connections) {
    const expired = !entry.busy && now - entry.lastUsedAtMs > idleTtlMs
    if (entry.client.isClosed || expired) {
      entry.client.close()
      continue
    }
    kept.push(entry)
  }

  kept.sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
  const retained = kept.slice(0, Math.max(1, maxHotConnections))
  for (const dropped of kept.slice(retained.length)) {
    dropped.client.close()
  }

  if (retained.length > 0) {
    HOT_CONNECTIONS.set(cacheKey, retained)
  } else {
    HOT_CONNECTIONS.delete(cacheKey)
  }
}

async function acquireConnection(params: {
  webSocketUrl: string
  headers?: Record<string, string>
  handshakeTimeoutMs?: number
  reuseHotConnection: boolean
  idleTtlMs: number
  maxHotConnections: number
}): Promise<{
  entry: HotConnection
  cacheKey: string
  reusedConnection: boolean
  acquireMs: number
  handshakeMs: number
}> {
  const startedAt = Date.now()
  const cacheKey = connectionCacheKey(params)
  pruneConnections(cacheKey, params.idleTtlMs, params.maxHotConnections)

  if (params.reuseHotConnection) {
    const reusable = (HOT_CONNECTIONS.get(cacheKey) ?? []).find(
      (entry) => !entry.busy && !entry.client.isClosed,
    )
    if (reusable) {
      reusable.busy = true
      reusable.requestCount += 1
      reusable.lastUsedAtMs = Date.now()
      return {
        entry: reusable,
        cacheKey,
        reusedConnection: true,
        acquireMs: Math.max(0, Date.now() - startedAt),
        handshakeMs: 0,
      }
    }
  }

  const client = new OpenAIResponsesWebSocket({
    webSocketUrl: params.webSocketUrl,
    headers: params.headers,
    handshakeTimeoutMs: params.handshakeTimeoutMs,
  })
  const handshakeStartedAt = Date.now()
  await client.connect()
  const handshakeMs = Math.max(0, Date.now() - handshakeStartedAt)
  const entry: HotConnection = {
    id: randomUUID(),
    client,
    busy: true,
    createdAtMs: Date.now(),
    lastUsedAtMs: Date.now(),
    requestCount: 1,
  }

  if (params.reuseHotConnection) {
    const list = HOT_CONNECTIONS.get(cacheKey) ?? []
    list.push(entry)
    HOT_CONNECTIONS.set(cacheKey, list)
    pruneConnections(cacheKey, params.idleTtlMs, params.maxHotConnections)
  }

  return {
    entry,
    cacheKey,
    reusedConnection: false,
    acquireMs: Math.max(0, Date.now() - startedAt),
    handshakeMs,
  }
}

function releaseConnection(params: {
  entry: HotConnection
  cacheKey: string
  keepAlive: boolean
}) {
  params.entry.busy = false
  params.entry.lastUsedAtMs = Date.now()

  if (params.keepAlive && !params.entry.client.isClosed) {
    return
  }

  params.entry.client.close()
  const list = (HOT_CONNECTIONS.get(params.cacheKey) ?? []).filter(
    (entry) => entry !== params.entry,
  )
  if (list.length > 0) {
    HOT_CONNECTIONS.set(params.cacheKey, list)
  } else {
    HOT_CONNECTIONS.delete(params.cacheKey)
  }
}

function responseErrorText(event: unknown) {
  const record = asRecord(event)
  const error = asRecord(record.error)
  return (
    (typeof error.message === "string" && error.message) ||
    (typeof record.message === "string" && record.message) ||
    (typeof record.type === "string" && record.type) ||
    "responses_websocket_error"
  )
}

export function parseOpenAIResponsesWebSocketMessage(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }

  if (typeof parsed !== "string") return parsed
  const nested = parsed.trim()
  if (!nested || (nested[0] !== "{" && nested[0] !== "[")) return parsed

  try {
    return JSON.parse(nested)
  } catch {
    return parsed
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, phase: string): Promise<T> {
  if (!timeoutMs || timeoutMs < 1) return await promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`OpenAIResponsesWebSocket: ${phase} timed out after ${timeoutMs}ms.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class OpenAIResponsesWebSocket {
  private socket: tls.TLSSocket | null = null
  private buffer = Buffer.alloc(0)
  private fragmentedMessage: Buffer[] = []
  private fragmentedOpcode: number | null = null
  private connected = false
  private closed = false
  private queue: unknown[] = []
  private pendingReads: PendingRead[] = []
  private readonly url: URL
  private readonly headers: Record<string, string>
  private readonly handshakeTimeoutMs: number

  constructor(params: OpenAIResponsesWebSocketConnection) {
    this.url = new URL(params.webSocketUrl)
    if (this.url.protocol !== "wss:") {
      throw new Error("OpenAIResponsesWebSocket: webSocketUrl must use wss://.")
    }
    this.headers = params.headers ?? {}
    this.handshakeTimeoutMs = params.handshakeTimeoutMs ?? 15_000
  }

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.closed) {
      throw new Error("OpenAIResponsesWebSocket: cannot reconnect a closed client.")
    }

    const host = this.url.hostname
    const port = this.url.port ? Number(this.url.port) : 443
    const requestPath = normalizeRequestPath(this.url)
    const secWebSocketKey = randomBytes(16).toString("base64")

    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        timeout: this.handshakeTimeoutMs,
      })
      this.socket = socket

      let handshakeBuffer = Buffer.alloc(0)
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(error)
      }
      const done = () => {
        if (settled) return
        settled = true
        this.connected = true
        resolve()
      }

      socket.once("secureConnect", () => {
        const lines = [
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${secWebSocketKey}`,
          "Sec-WebSocket-Version: 13",
          "User-Agent: ekairos-openai-responses-reactor",
          ...Object.entries(this.headers).map(([key, value]) => `${key}: ${value}`),
          "",
          "",
        ]
        socket.write(lines.join("\r\n"))
      })

      socket.on("data", (chunk) => {
        if (settled) {
          this.handleData(chunk)
          return
        }

        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk])
        const headerEnd = handshakeBuffer.indexOf("\r\n\r\n")
        if (headerEnd === -1) return

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString("utf8")
        const body = handshakeBuffer.subarray(headerEnd + 4)
        const statusMatch = headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*([^\r\n]*)/)
        const status = statusMatch ? Number(statusMatch[1]) : 0
        if (status !== 101) {
          fail(
            new Error(
              [
                `OpenAIResponsesWebSocket: handshake failed with HTTP ${status || "unknown"}.`,
                statusMatch?.[2] ? `Status: ${statusMatch[2]}.` : "",
                body.length ? `Body: ${body.toString("utf8").slice(0, 1_000)}` : "",
                `URL: ${trimTrailingSlash(this.url.origin)}${this.url.pathname}`,
                `Headers: ${JSON.stringify(redactHeaders(this.headers))}`,
              ]
                .filter(Boolean)
                .join(" "),
            ),
          )
          return
        }

        this.buffer = body
        done()
        this.drainFrames()
      })

      socket.once("timeout", () => {
        fail(new Error("OpenAIResponsesWebSocket: handshake timed out."))
      })
      socket.once("error", fail)
      socket.once("close", () => {
        this.closed = true
        this.rejectPending(new Error("OpenAIResponsesWebSocket: connection closed."))
      })
    })
  }

  async send(value: unknown): Promise<void> {
    await this.connect()
    const socket = this.socket
    if (!socket || this.closed) {
      throw new Error("OpenAIResponsesWebSocket: connection is closed.")
    }
    socket.write(createClientFrame(JSON.stringify(value)))
  }

  async read(): Promise<unknown> {
    if (this.queue.length > 0) return this.queue.shift()
    if (this.closed) throw new Error("OpenAIResponsesWebSocket: connection is closed.")
    return await new Promise<unknown>((resolve, reject) => {
      this.pendingReads.push({ resolve, reject })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.socket?.end(Buffer.from([0x88, 0x00]))
    } catch {
      // noop
    }
    try {
      this.socket?.destroy()
    } catch {
      // noop
    }
    this.rejectPending(new Error("OpenAIResponsesWebSocket: connection closed."))
  }

  get isClosed() {
    return this.closed
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.drainFrames()
  }

  private drainFrames() {
    while (this.buffer.length > 0) {
      const frame = parseFrame(this.buffer)
      if (!frame) return
      this.buffer = this.buffer.subarray(frame.consumed)

      if (frame.opcode === 0x8) {
        this.closed = true
        this.rejectPending(new Error("OpenAIResponsesWebSocket: server closed the connection."))
        return
      }

      if (frame.opcode === 0x9) {
        this.socket?.write(createPongFrame(frame.payload))
        continue
      }

      if (frame.opcode !== 0x1 && frame.opcode !== 0x0) {
        continue
      }

      if (frame.opcode === 0x1) {
        if (frame.fin) {
          this.emit(parseOpenAIResponsesWebSocketMessage(frame.payload.toString("utf8")))
          continue
        }

        this.fragmentedOpcode = frame.opcode
        this.fragmentedMessage = [frame.payload]
        continue
      }

      if (this.fragmentedOpcode === null) {
        continue
      }

      this.fragmentedMessage.push(frame.payload)
      if (!frame.fin) {
        continue
      }

      const payload = Buffer.concat(this.fragmentedMessage)
      this.fragmentedMessage = []
      this.fragmentedOpcode = null
      this.emit(parseOpenAIResponsesWebSocketMessage(payload.toString("utf8")))
    }
  }

  private emit(value: unknown) {
    const pending = this.pendingReads.shift()
    if (pending) {
      pending.resolve(value)
      return
    }
    this.queue.push(value)
  }

  private rejectPending(error: Error) {
    const pending = this.pendingReads.splice(0)
    for (const reader of pending) {
      reader.reject(error)
    }
  }
}

export async function streamOpenAIResponsesWebSocket(
  params: StreamOpenAIResponsesWebSocketParams,
): Promise<OpenAIResponsesStreamMetrics> {
  const reuseHotConnection = params.reuseHotConnection !== false
  const idleTtlMs = Math.max(1_000, Number(params.idleTtlMs ?? 120_000))
  const maxHotConnections = Math.max(1, Number(params.maxHotConnections ?? 4))
  const requestTimeoutMs =
    params.requestTimeoutMs === undefined ? undefined : Math.max(1, Number(params.requestTimeoutMs))
  const startedAt = Date.now()

  const acquired = await acquireConnection({
    webSocketUrl: params.webSocketUrl,
    headers: params.headers,
    handshakeTimeoutMs: params.handshakeTimeoutMs,
    reuseHotConnection,
    idleTtlMs,
    maxHotConnections,
  })

  const metrics: OpenAIResponsesStreamMetrics = {
    cacheKey: acquired.cacheKey,
    connectionId: acquired.entry.id,
    connectionMode: acquired.reusedConnection ? "hot" : "cold",
    reusedConnection: acquired.reusedConnection,
    acquireMs: acquired.acquireMs,
    handshakeMs: acquired.handshakeMs,
    providerEventCount: 0,
  }

  let keepAlive = reuseHotConnection
  try {
    await withTimeout(
      acquired.entry.client.send({
        type: "response.create",
        ...params.request,
        stream: true,
      }),
      requestTimeoutMs,
      "send",
    )

    while (true) {
      const event = await withTimeout(acquired.entry.client.read(), requestTimeoutMs, "receive")
      const now = Date.now()
      const type = eventType(event)
      metrics.providerEventCount += 1
      if (metrics.firstProviderEventMs === undefined) {
        metrics.firstProviderEventMs = Math.max(0, now - startedAt)
      }
      if (metrics.firstTextDeltaMs === undefined && type === "response.output_text.delta") {
        metrics.firstTextDeltaMs = Math.max(0, now - startedAt)
      }

      await params.onEvent(event, metrics)

      if (!isTerminalEvent(type)) {
        continue
      }

      metrics.completedMs = Math.max(0, Date.now() - startedAt)
      if (isFailureEvent(type)) {
        keepAlive = false
        throw new Error(responseErrorText(event))
      }
      return metrics
    }
  } catch (error) {
    keepAlive = false
    throw error
  } finally {
    releaseConnection({
      entry: acquired.entry,
      cacheKey: acquired.cacheKey,
      keepAlive,
    })
  }
}
