import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import http, { type ServerResponse } from "node:http"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface, type Interface } from "node:readline"

type JsonRecord = Record<string, unknown>

type PendingRpc = {
  resolve: (payload: JsonRecord) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object") return {}
  return value as JsonRecord
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizeUrl(base: string): string {
  return base.endsWith("/") ? base.slice(0, -1) : base
}

function seedCodexAuthFiles(targetCodexHome: string): void {
  const currentCodexHome =
    asString(process.env.CODEX_HOME).trim() || join(homedir(), ".codex")
  const authFiles = ["auth.json", ".credentials.json", "config.toml"]
  for (const fileName of authFiles) {
    const source = join(currentCodexHome, fileName)
    if (!existsSync(source)) continue
    const destination = join(targetCodexHome, fileName)
    try {
      copyFileSync(source, destination)
    } catch {
      // best-effort copy; auth can still be provided through other means
    }
  }
}

function isValidCodexThreadId(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true
  return false
}

function parseRequestBody(rawBody: string): JsonRecord {
  if (!rawBody.trim()) return {}
  try {
    return asRecord(JSON.parse(rawBody))
  } catch {
    throw new Error("invalid_json")
  }
}

export default async function setupCodexRealEnvironment() {
  const explicitUrl = asString(process.env.CODEX_REACTOR_REAL_URL).trim()
  const autoStartEnabled = asString(process.env.CODEX_REACTOR_REAL).trim() === "1"
  if (explicitUrl || !autoStartEnabled) {
    return
  }

  let codexProcess: ChildProcessWithoutNullStreams | null = null
  let codexStdout: Interface | null = null
  let bridgeServer: http.Server | null = null
  const pendingRpc = new Map<string, PendingRpc>()
  const sseSubscribers = new Set<ServerResponse>()
  const eventWatchers = new Set<(payload: JsonRecord) => void>()

  const emitSse = (payload: JsonRecord) => {
    const chunk = `data: ${JSON.stringify(payload)}\n\n`
    for (const response of sseSubscribers) {
      try {
        response.write(chunk)
      } catch {
        sseSubscribers.delete(response)
      }
    }
  }

  const emitEventWatchers = (payload: JsonRecord) => {
    for (const watcher of eventWatchers) {
      try {
        watcher(payload)
      } catch {
        // test watchers are non-critical
      }
    }
  }

  const subscribeEvents = (handler: (payload: JsonRecord) => void) => {
    eventWatchers.add(handler)
    return () => {
      eventWatchers.delete(handler)
    }
  }

  const handleStdoutLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let payload: JsonRecord
    try {
      payload = asRecord(JSON.parse(trimmed))
    } catch {
      return
    }

    const id = asString(payload.id)
    if (id && pendingRpc.has(id)) {
      const pending = pendingRpc.get(id)!
      pendingRpc.delete(id)
      clearTimeout(pending.timer)
      const rpcError = payload.error
      if (rpcError !== undefined && rpcError !== null) {
        const errorMessage =
          asString(asRecord(rpcError).message).trim() ||
          asString(rpcError).trim() ||
          "rpc_error"
        pending.reject(new Error(errorMessage))
        return
      }
      pending.resolve(payload)
      return
    }

    emitSse(payload)
    emitEventWatchers(payload)
  }

  const sendRpc = async (method: string, params?: JsonRecord): Promise<JsonRecord> => {
    if (!codexProcess) throw new Error("codex_app_server_not_started")
    const id = randomUUID()
    const request: JsonRecord = { id, method }
    if (params) request.params = params

    return await new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(id)
        reject(new Error(`rpc_timeout:${method}`))
      }, 60_000)

      pendingRpc.set(id, { resolve, reject, timer })
      codexProcess!.stdin.write(`${JSON.stringify(request)}\n`)
    })
  }

  const initializeCodexAppServer = async () => {
    await sendRpc("initialize", {
      clientInfo: { name: "ekairos-openai-reactor-tests", version: "1.0.0" },
      capabilities: {},
    })
    if (!codexProcess) throw new Error("codex_app_server_not_started")
    codexProcess.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`)
  }

  const runTurn = async (body: JsonRecord): Promise<JsonRecord> => {
    const instruction = asString(body.instruction).trim()
    const config = asRecord(body.config)
    const runtime = asRecord(body.runtime)
    const requestedThreadId = asString(config.threadId).trim()
    const repoPath = asString(config.repoPath).trim() || process.cwd()
    const model = asString(config.model).trim()
    const approvalPolicy = asString(config.approvalPolicy).trim() || "on-request"
    const incomingSandboxPolicy = asRecord(config.sandboxPolicy)
    const sandboxPolicy =
      Object.keys(incomingSandboxPolicy).length > 0
        ? incomingSandboxPolicy
        : { type: "externalSandbox", networkAccess: "enabled" }

    let threadId = requestedThreadId
    if (threadId && isValidCodexThreadId(threadId)) {
      await sendRpc("thread/resume", { threadId })
    } else {
      threadId = ""
      const threadStartParams: JsonRecord = {
        cwd: repoPath,
        approvalPolicy,
        sandboxPolicy,
      }
      if (model) {
        threadStartParams.model = model
      }
      const startRes = await sendRpc("thread/start", threadStartParams)
      threadId =
        asString(asRecord(asRecord(startRes.result).thread).id) ||
        asString(asRecord(startRes.result).id) ||
        asString(asRecord(startRes).threadId)
    }

    if (!threadId) throw new Error("thread_id_missing")

    const inputParts = instruction
      ? [{ type: "text", text: instruction }]
      : [{ type: "text", text: "" }]

    const stream: JsonRecord[] = []
    let assistantText = ""
    let reasoningText = ""
    let diff = ""
    let usage: JsonRecord = {}
    let turnId = ""

    let resolveStartedTurn: ((value: string) => void) | null = null
    const startedTurnPromise = new Promise<string>((resolve) => {
      resolveStartedTurn = resolve
    })

    const completedTurnPromise = new Promise<JsonRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error("turn_completion_timeout"))
      }, 180_000)

      const unsubscribe = subscribeEvents((evt) => {
        const method = asString(evt.method)
        if (!method || method.startsWith("codex/event/")) return

        const params = asRecord(evt.params)
        const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id)
        const evtThreadId = asString(params.threadId) || asString(asRecord(params.turn).threadId)
        if (method === "turn/started") {
          const startedId = asString(asRecord(params.turn).id) || evtTurnId
          if (!turnId && startedId && evtThreadId === threadId && resolveStartedTurn) {
            turnId = startedId
            resolveStartedTurn(startedId)
            resolveStartedTurn = null
          }
        }

        const scopedTurnId = turnId || evtTurnId
        const scopedToTurn =
          (evtTurnId && scopedTurnId && evtTurnId === scopedTurnId) ||
          (evtThreadId && evtThreadId === threadId) ||
          method.startsWith("thread/")
        if (!scopedToTurn) return

        stream.push(evt)

        if (method === "item/agentMessage/delta") {
          assistantText += asString(params.delta)
        }
        if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
          reasoningText += asString(params.delta)
        }
        if (method === "turn/diff/updated") {
          diff = asString(params.diff)
        }
        if (method === "thread/tokenUsage/updated") {
          usage = asRecord(params.tokenUsage)
        }
        if (method === "item/completed") {
          const item = asRecord(params.item)
          if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
            assistantText = asString(item.text)
          }
          if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
            reasoningText = asString(item.summary)
          }
        }
        if (method === "turn/completed") {
          const turnData = asRecord(params.turn)
          const completedTurnId = asString(turnData.id)
          if (completedTurnId && turnId && completedTurnId !== turnId) return
          const completedItems = asArray<JsonRecord>(turnData.items)
          for (const item of completedItems) {
            if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
              assistantText = asString(item.text)
            }
            if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
              reasoningText = asString(item.summary)
            }
          }
          clearTimeout(timeout)
          unsubscribe()
          resolve(turnData)
        }
      })
    })

    const turnStartParams: JsonRecord = {
      threadId,
      input: inputParts,
      cwd: repoPath,
      approvalPolicy,
      sandboxPolicy,
    }
    if (model) {
      turnStartParams.model = model
    }
    const turnStartRes = await sendRpc("turn/start", turnStartParams)

    const turnResult = asRecord(turnStartRes.result)
    const turn = asRecord(turnResult.turn)
    turnId =
      asString(turn.id).trim() ||
      asString(turnResult.turnId).trim() ||
      asString(turnResult.id).trim()
    if (!turnId) {
      try {
        turnId = await Promise.race([
          startedTurnPromise,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("turn_started_timeout")), 20_000),
          ),
        ])
      } catch (error) {
        throw new Error(
          `turn_started_timeout turnStartRes=${JSON.stringify(turnStartRes)} error=${asString(
            error instanceof Error ? error.message : error,
          )}`,
        )
      }
    }

    const completedTurn = await completedTurnPromise

    return {
      threadId,
      turnId,
      assistantText,
      reasoningText,
      diff,
      usage,
      stream,
      metadata: {
        provider: "codex-app-server",
        runtime,
        completedTurn,
      },
    }
  }

  const startBridgeServer = async (): Promise<string> => {
    const forcedPort = Number(process.env.CODEX_REACTOR_REAL_PORT || "0")
    await new Promise<void>((resolve, reject) => {
      bridgeServer = http.createServer((request, response) => {
        const method = asString(request.method).toUpperCase()
        const url = asString(request.url)

        if (method === "GET" && url === "/health") {
          response.writeHead(200, { "content-type": "application/json" })
          response.end(JSON.stringify({ ok: true }))
          return
        }

        if (method === "GET" && url === "/events") {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          })
          response.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`)
          sseSubscribers.add(response)
          request.on("close", () => sseSubscribers.delete(response))
          return
        }

        if (method === "POST" && url === "/rpc") {
          let body = ""
          request.on("data", (chunk) => {
            body += chunk.toString()
          })
          request.on("end", async () => {
            try {
              const payload = parseRequestBody(body)
              const rpcMethod = asString(payload.method).trim()
              if (!rpcMethod) throw new Error("rpc_method_required")
              const rpcResponse = await sendRpc(rpcMethod, asRecord(payload.params))
              response.writeHead(200, { "content-type": "application/json" })
              response.end(JSON.stringify(rpcResponse))
            } catch (error) {
              response.writeHead(500, { "content-type": "application/json" })
              response.end(
                JSON.stringify({ error: asString(error instanceof Error ? error.message : error) }),
              )
            }
          })
          return
        }

        if (method === "POST" && url === "/turn") {
          let body = ""
          request.on("data", (chunk) => {
            body += chunk.toString()
          })
          request.on("end", async () => {
            try {
              const payload = parseRequestBody(body)
              const result = await runTurn(payload)
              response.writeHead(200, { "content-type": "application/json" })
              response.end(JSON.stringify(result))
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error(
                "[codex-real.setup:/turn:error]",
                error instanceof Error ? error.message : error,
              )
              response.writeHead(500, { "content-type": "application/json" })
              response.end(
                JSON.stringify({ error: asString(error instanceof Error ? error.message : error) }),
              )
            }
          })
          return
        }

        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "not_found" }))
      })

      bridgeServer.on("error", reject)
      bridgeServer.listen(forcedPort, "127.0.0.1", () => resolve())
    })

    const address = bridgeServer.address()
    if (!address || typeof address !== "object") {
      throw new Error("bridge_server_address_unavailable")
    }
    return `http://127.0.0.1:${address.port}`
  }

  const isWindows = process.platform === "win32"
  const codexHome =
    asString(process.env.CODEX_REACTOR_CODEX_HOME).trim() ||
    join(tmpdir(), "ekairos-openai-reactor-codex-home")
  mkdirSync(codexHome, { recursive: true })
  seedCodexAuthFiles(codexHome)

  const codexEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: codexHome,
  }

  codexProcess = isWindows
    ? spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "codex app-server"],
        {
          stdio: ["pipe", "pipe", "inherit"],
          env: codexEnv,
        },
      )
    : spawn("codex", ["app-server"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: codexEnv,
      })

  codexProcess.once("error", (error) => {
    throw new Error(`codex_app_server_spawn_failed: ${asString(error instanceof Error ? error.message : error)}`)
  })
  codexStdout = createInterface({ input: codexProcess.stdout })
  codexStdout.on("line", handleStdoutLine)

  await initializeCodexAppServer()
  const baseUrl = await startBridgeServer()
  process.env.CODEX_REACTOR_REAL_URL = `${normalizeUrl(baseUrl)}/turn`

  return async () => {
    for (const [id, pending] of pendingRpc.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`rpc_cancelled:${id}`))
      pendingRpc.delete(id)
    }
    sseSubscribers.clear()
    eventWatchers.clear()
    codexStdout?.close()
    codexStdout = null

    await new Promise<void>((resolve) => {
      if (!bridgeServer) {
        resolve()
        return
      }
      bridgeServer.close(() => {
        bridgeServer = null
        resolve()
      })
    })

    if (codexProcess) {
      const processRef = codexProcess
      codexProcess = null
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        processRef.once("exit", done)
        try {
          processRef.kill("SIGTERM")
        } catch {
          done()
        }
        setTimeout(() => {
          try {
            processRef.kill("SIGKILL")
          } catch {
            // process already down
          }
          resolve()
        }, 2_000)
      })
    }
  }
}
