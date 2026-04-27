import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"
import { createInterface, type Interface } from "node:readline"
import {
  OUTPUT_ITEM_TYPE,
  type ContextSkillPackage,
  type ContextItem,
  type ContextReactionResult,
  type ContextReactor,
  type ContextReactorParams,
  actionsToActionSpecs,
} from "@ekairos/events"
import { createCodexReactor, type CodexConfig } from "@ekairos/openai-reactor"

type JsonRecord = Record<string, unknown>

type PendingRpc = {
  resolve: (payload: JsonRecord) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CodexRealTurnResult = {
  providerContextId: string
  turnId: string
  assistantText: string
  reasoningText: string
  diff: string
  usage: JsonRecord
  stream: JsonRecord[]
}

export type RealCodexRunner = {
  runTurn: (params: {
    instruction: string
    repoPath: string
    providerContextId?: string
    approvalPolicy?: string
    skills?: ContextSkillPackage[]
    onEvent?: (event: JsonRecord) => Promise<void> | void
  }) => Promise<CodexRealTurnResult>
  dispose: () => Promise<void>
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

const BENCHMARK_TIMINGS = process.env.EKAIROS_BENCHMARK_TIMINGS === "1"

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function benchmarkLog(label: string, data: Record<string, unknown>) {
  if (!BENCHMARK_TIMINGS) return
  console.log(`[dataset-codex-benchmark] ${JSON.stringify({ source: "codex.real", stage: label, ...data })}`)
}

function inferTurnLabel(instruction: string): string {
  const datasetId = instruction.match(/\bcodex_skill_[a-z0-9_]+\b/i)?.[0]
  if (datasetId) return datasetId

  const firstLine = instruction
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine?.slice(0, 80) || "turn"
}

function isValidProviderContextId(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true
  return false
}

function findNearestCodexProjectRoot(startPath: string): string {
  let current = startPath
  const root = parse(current).root

  while (current && current !== root) {
    if (existsSync(join(current, ".codex"))) return current
    current = dirname(current)
  }

  return startPath
}

function formatTomlString(value: string): string {
  return JSON.stringify(value)
}

function writeTempCodexConfig(codexHome: string) {
  const projectRoot = findNearestCodexProjectRoot(process.cwd())
  const trustedProjects = Array.from(
    new Set([
      projectRoot,
      projectRoot.toLowerCase(),
      process.cwd(),
      process.cwd().toLowerCase(),
    ]),
  )

  const content = trustedProjects
    .map((projectPath) => [`[projects.${formatTomlString(projectPath)}]`, 'trust_level = "trusted"'].join("\n"))
    .join("\n\n")

  writeFileSync(join(codexHome, "config.toml"), `${content}\n`, "utf8")
}

function textFromTriggerEvent(event: ContextItem): string {
  const parts = Array.isArray((event as any)?.content?.parts) ? (event as any).content.parts : []
  return parts
    .map((part: any) => (part?.type === "text" ? String(part.text ?? "") : ""))
    .join("\n")
    .trim()
}

function stripJsonFences(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
}

function parseToolCallPayload(value: string): { tool?: string; input?: unknown } | null {
  try {
    const parsed = JSON.parse(stripJsonFences(value))
    if (!parsed || typeof parsed !== "object") return null
    return parsed as { tool?: string; input?: unknown }
  } catch {
    return null
  }
}

export async function setupRealCodexRunner(params?: {
  env?: Record<string, string>
}): Promise<RealCodexRunner> {
  const setupStartedAt = Date.now()
  let codexProcess: ChildProcessWithoutNullStreams | null = null
  let codexStdout: Interface | null = null
  const pendingRpc = new Map<string, PendingRpc>()
  const eventWatchers = new Set<(payload: JsonRecord) => void>()

  const emitEvent = (payload: JsonRecord) => {
    for (const watcher of eventWatchers) {
      watcher(payload)
    }
  }

  const subscribe = (handler: (payload: JsonRecord) => void) => {
    eventWatchers.add(handler)
    return () => eventWatchers.delete(handler)
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
        pending.reject(new Error(asString(asRecord(rpcError).message) || asString(rpcError) || "rpc_error"))
        return
      }
      pending.resolve(payload)
      return
    }

    emitEvent(payload)
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

  const isWindows = process.platform === "win32"
  const currentCodexHome = asString(process.env.CODEX_HOME).trim() || join(homedir(), ".codex")
  const codexHome = join(tmpdir(), `ekairos-dataset-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(codexHome, { recursive: true })
  mkdirSync(join(codexHome, "skills"), { recursive: true })
  writeTempCodexConfig(codexHome)
  for (const fileName of ["auth.json", ".credentials.json"]) {
    const source = join(currentCodexHome, fileName)
    if (!existsSync(source)) continue
    copyFileSync(source, join(codexHome, fileName))
  }

  const installSkills = (skills: ContextSkillPackage[] | undefined) => {
    for (const skill of skills ?? []) {
      const skillName = asString(skill.name).trim()
      if (!skillName) continue
      const skillRoot = join(codexHome, "skills", skillName)
      mkdirSync(skillRoot, { recursive: true })
      for (const file of skill.files ?? []) {
        const relativePath = asString(file.path).replace(/\\/g, "/").replace(/^\/+/, "").trim()
        if (!relativePath) continue
        const absolutePath = join(skillRoot, ...relativePath.split("/"))
        mkdirSync(dirname(absolutePath), { recursive: true })
        writeFileSync(absolutePath, Buffer.from(asString(file.contentBase64), "base64"))
      }
    }
  }

  codexProcess = isWindows
    ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "codex app-server"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, CODEX_HOME: codexHome, ...(params?.env ?? {}) },
      })
    : spawn("codex", ["app-server"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, CODEX_HOME: codexHome, ...(params?.env ?? {}) },
      })

  codexStdout = createInterface({ input: codexProcess.stdout })
  codexStdout.on("line", handleStdoutLine)

  const initializeStartedAt = Date.now()
  await sendRpc("initialize", {
    clientInfo: { name: "ekairos-dataset-tests", version: "1.0.0" },
    capabilities: {},
  })
  codexProcess.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`)
  benchmarkLog("runner.initialize", { ms: Date.now() - initializeStartedAt })
  benchmarkLog("runner.setup", { ms: Date.now() - setupStartedAt })

  return {
    async runTurn(params) {
      const runStartedAt = Date.now()
      const turnLabel = inferTurnLabel(params.instruction)
      const skillsStartedAt = Date.now()
      installSkills(params.skills)
      const skillsMs = Date.now() - skillsStartedAt
      const requestedThreadId = asString(params.providerContextId).trim()
      let threadId = requestedThreadId
      const threadStartedAt = Date.now()
      let threadOperation = "resume"
      if (threadId && isValidProviderContextId(threadId)) {
        await sendRpc("thread/resume", { threadId })
      } else {
        threadOperation = "start"
        const started = await sendRpc("thread/start", {
          cwd: params.repoPath,
          approvalPolicy: params.approvalPolicy ?? "never",
          sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" },
        })
        threadId =
          asString(asRecord(asRecord(started.result).thread).id) ||
          asString(asRecord(started.result).id) ||
          asString(started.threadId)
      }

      if (!threadId) throw new Error("thread_id_missing")
      const threadMs = Date.now() - threadStartedAt

      const turnStartStartedAt = Date.now()
      const turnStart = await sendRpc("turn/start", {
        threadId,
        input: [{ type: "text", text: params.instruction }],
        cwd: params.repoPath,
        approvalPolicy: params.approvalPolicy ?? "never",
        sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" },
      })

      let turnId =
        asString(asRecord(asRecord(turnStart.result).turn).id) ||
        asString(asRecord(turnStart.result).id) ||
        asString(turnStart.turnId)
      const turnStartMs = Date.now() - turnStartStartedAt

      let assistantText = ""
      let reasoningText = ""
      let diff = ""
      let usage: JsonRecord = {}
      const stream: JsonRecord[] = []
      let onEventChain: Promise<void> = Promise.resolve()
      const emitRunnerEvent = (event: JsonRecord) => {
        if (!params.onEvent) return
        onEventChain = onEventChain.then(async () => {
          await params.onEvent!(event)
        })
      }

      const waitStartedAt = Date.now()
      const turnTimeoutMs = readPositiveIntEnv("EKAIROS_CODEX_TURN_TIMEOUT_MS", 180_000)
      let completedTurn: JsonRecord
      try {
        completedTurn = await new Promise<JsonRecord>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe()
          reject(new Error("turn_completion_timeout"))
        }, turnTimeoutMs)

        const unsubscribe = subscribe((event) => {
          const method = asString(event.method)
          const eventParams = asRecord(event.params)
          const eventTurnId = asString(eventParams.turnId) || asString(asRecord(eventParams.turn).id)
          const eventThreadId =
            asString(eventParams.threadId) ||
            asString(asRecord(eventParams.turn).threadId) ||
            asString(eventParams.providerContextId)

          if (!turnId && method === "turn/started") {
            turnId = asString(asRecord(eventParams.turn).id) || eventTurnId
          }

          if (eventThreadId && eventThreadId !== threadId && eventTurnId && turnId && eventTurnId !== turnId) {
            return
          }

          stream.push(event)
          emitRunnerEvent(event)

          if (method === "item/agentMessage/delta") {
            assistantText += asString(eventParams.delta)
          }
          if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
            reasoningText += asString(eventParams.delta)
          }
          if (method === "turn/diff/updated") {
            diff = asString(eventParams.diff)
          }
          if (method === "context/tokenUsage/updated" || method === "thread/tokenUsage/updated") {
            usage = asRecord(eventParams.tokenUsage)
          }
          if (method === "item/completed") {
            const item = asRecord(eventParams.item)
            if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
              assistantText = asString(item.text)
            }
            if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
              reasoningText = asString(item.summary)
            }
          }
          if (method === "turn/completed") {
            clearTimeout(timeout)
            unsubscribe()
            resolve(asRecord(eventParams.turn))
          }
        })
      })
      } catch (error) {
        const waitMs = Date.now() - waitStartedAt
        benchmarkLog("runner.runTurn.failed", {
          label: turnLabel,
          totalMs: Date.now() - runStartedAt,
          skillsMs,
          threadMs,
          threadOperation,
          turnStartMs,
          waitMs,
          timeoutMs: turnTimeoutMs,
          streamEvents: stream.length,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      await onEventChain
      const waitMs = Date.now() - waitStartedAt
      const commandDurations = stream
        .map((event) => {
          if (asString(event.method) !== "item/completed") return undefined
          const item = asRecord(asRecord(event.params).item)
          if (asString(item.type) !== "commandExecution") return undefined
          return typeof item.durationMs === "number" ? item.durationMs : undefined
        })
        .filter((entry): entry is number => typeof entry === "number")

      benchmarkLog("runner.runTurn", {
        label: turnLabel,
        totalMs: Date.now() - runStartedAt,
        skillsMs,
        threadMs,
        threadOperation,
        turnStartMs,
        waitMs,
        streamEvents: stream.length,
        commandCount: commandDurations.length,
        commandDurationMs: commandDurations.reduce((total, entry) => total + entry, 0),
      })

      return {
        providerContextId: threadId,
        turnId,
        assistantText,
        reasoningText,
        diff,
        usage: {
          ...usage,
          completedTurn,
        },
        stream,
      }
    },
    async dispose() {
      for (const [id, pending] of pendingRpc.entries()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`rpc_cancelled:${id}`))
        pendingRpc.delete(id)
      }
      eventWatchers.clear()
      codexStdout?.close()
      codexStdout = null
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
              // already closed
            }
            resolve()
          }, 2_000)
        })
      }
    },
  }
}

export function createCodexJsonToolReactor<Context, Env extends { repoPath: string; approvalPolicy?: string }>(
  params: {
    runner: RealCodexRunner
    repoPath: string
    approvalPolicy?: string
  },
): ContextReactor<Context, Env> {
  return async (reactorParams: ContextReactorParams<Context, Env>): Promise<ContextReactionResult> => {
    const toolSpecs = Object.entries(actionsToActionSpecs(reactorParams.actions)).map(([name, definition]) => {
      const record = asRecord(definition)
      return {
        name,
        description: asString(record.description),
        inputSchema: record.inputSchema ?? null,
      }
    })

    const instruction = [
      reactorParams.systemPrompt,
      "",
      "You must pick exactly one local tool call when a tool is available.",
      "Return ONLY valid JSON with this shape and nothing else:",
      '{"tool":"tool_name","input":{}}',
      "",
      "Available local tools:",
      JSON.stringify(toolSpecs, null, 2),
      "",
      "User request:",
      textFromTriggerEvent(reactorParams.triggerEvent),
    ].join("\n")

    const turn = await params.runner.runTurn({
      instruction,
      repoPath: params.repoPath,
      approvalPolicy: params.approvalPolicy ?? "never",
      skills: reactorParams.skills,
    })

    const parsed = parseToolCallPayload(turn.assistantText)
    const toolName = asString(parsed?.tool).trim()
    const toolInput = parsed?.input
    const actionRef = randomUUID()
    const toolPart =
      toolName && Object.prototype.hasOwnProperty.call(reactorParams.actions, toolName)
        ? [
            {
              type: `tool-${toolName}`,
              toolCallId: actionRef,
              input: toolInput ?? {},
            },
          ]
        : []

    return {
      assistantEvent: {
        id: reactorParams.eventId,
        type: OUTPUT_ITEM_TYPE,
        channel: "web",
        createdAt: new Date().toISOString(),
        status: "completed",
        content: {
          parts: [
            {
              type: "text",
              text: turn.assistantText,
            },
            ...toolPart,
          ],
        },
      },
      actionRequests:
        toolPart.length > 0
          ? [
              {
                actionRef,
                actionName: toolName,
                input: toolInput ?? {},
              },
            ]
          : [],
      messagesForModel: [],
      llm: {
        provider: "codex-app-server",
        model: "codex",
        rawUsage: turn.usage,
      },
    }
  }
}

export function createRealCodexCommandReactor<Context, Env extends { repoPath: string; approvalPolicy?: string }>(
  params: {
    runner: RealCodexRunner
    repoPath: string
    approvalPolicy?: string
  },
) {
  return createCodexReactor<Context, CodexConfig, Env>({
    resolveConfig: async () => ({
      appServerUrl: "http://127.0.0.1/unused",
      repoPath: params.repoPath,
      approvalPolicy: params.approvalPolicy ?? "never",
      mode: "local",
    }),
    executeTurn: async (args) => {
      const turn = await params.runner.runTurn({
        instruction: args.instruction,
        repoPath: args.config.repoPath,
        providerContextId: args.config.providerContextId,
        approvalPolicy: args.config.approvalPolicy,
        skills: args.skills,
        onEvent: args.emitChunk,
      })

      return {
        providerContextId: turn.providerContextId,
        turnId: turn.turnId,
        assistantText: turn.assistantText,
        reasoningText: turn.reasoningText,
        diff: turn.diff,
        usage: turn.usage,
      }
    },
  })
}
