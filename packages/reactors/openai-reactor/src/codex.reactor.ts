import {
  OUTPUT_ITEM_TYPE,
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
  type ContextSkillPackage,
  type ContextItem,
  type ContextReactionResult,
  type ContextReactor,
  type ContextReactorParams,
  type ContextStreamChunkType,
} from "@ekairos/events"
import type { ContextEnvironment } from "@ekairos/events/runtime"

import { asRecord, asString, buildCodexParts, defaultInstructionFromTrigger, type AnyRecord } from "./shared.js"

export type CodexConfig = {
  appServerUrl: string
  repoPath: string
  providerContextId?: string
  mode?: "local" | "remote" | "sandbox"
  model?: string
  approvalPolicy?: string
  sandboxPolicy?: Record<string, unknown>
  sandbox?: CodexSandboxConfig
}

export type CodexSandboxConfig = {
  sandboxId?: string
  provider?: "sprites"
  runtime?: string
  purpose?: string
  spriteName?: string
  codexHome?: string
  authJsonPath?: string
  credentialsJsonPath?: string
  configTomlPath?: string
  bridgePort?: number
  appPort?: number
  createApp?: boolean
  installApp?: boolean
  startApp?: boolean
  checkpoint?: boolean
  debugExposeBridge?: boolean
}

export type CodexTurnResult = {
  providerContextId: string
  turnId: string
  assistantText: string
  reasoningText?: string
  diff?: string
  toolParts?: unknown[]
  metadata?: Record<string, unknown>
  usage?: Record<string, unknown>
}

export type CodexExecuteTurnArgs<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  env: Env
  runtime?: unknown
  context: AnyRecord
  triggerEvent: ContextItem
  contextId: string
  eventId: string
  executionId: string
  stepId: string
  iteration: number
  instruction: string
  config: Config
  skills: ContextSkillPackage[]
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<unknown>
  silent: boolean
  emitChunk: (providerChunk: unknown) => Promise<void>
}

export type CodexAppServerTurnStepArgs<
  Config extends CodexConfig = CodexConfig,
> = {
  config: Config
  env?: ContextEnvironment
  runtime?: unknown
  instruction: string
  contextId: string
  eventId: string
  executionId: string
  stepId: string
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<unknown>
  silent: boolean
}

export type CodexChunkMappingResult = {
  chunkType: ContextStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
  skip?: boolean
}

export type CodexMappedChunk = {
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

const PROVIDER_SCOPE_PREFIX = "context/"
const PROVIDER_STARTED = "context/started"
const PROVIDER_ARCHIVED = "context/archived"
const PROVIDER_UNARCHIVED = "context/unarchived"
const PROVIDER_NAME_UPDATED = "context/name/updated"
const PROVIDER_USAGE_UPDATED = "context/tokenUsage/updated"

export type CodexStreamTrace = {
  totalChunks: number
  chunkTypes: Record<string, number>
  providerChunkTypes: Record<string, number>
  chunks?: CodexMappedChunk[]
}

type CodexEmitPayload = {
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  provider: "codex"
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

export type CreateCodexReactorOptions<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  toolName?: string
  includeReasoningPart?: boolean
  buildInstruction?: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ContextItem
  }) => string | Promise<string>
  resolveConfig: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ContextItem
    contextId: string
    eventId: string
    executionId: string
    stepId: string
    iteration: number
  }) => Promise<Config>
  executeTurn?: (
    args: CodexExecuteTurnArgs<Context, Config, Env>,
  ) => Promise<CodexTurnResult>
  mapChunk?: (providerChunk: unknown) => CodexChunkMappingResult | null
  includeStreamTraceInOutput?: boolean
  includeRawProviderChunksInOutput?: boolean
  maxPersistedStreamChunks?: number
  onMappedChunk?: (
    chunk: CodexMappedChunk,
    params: ContextReactorParams<Context, Env>,
  ) => Promise<void> | void
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

export function mapCodexChunkType(providerChunkType: string): ContextStreamChunkType {
  const value = providerChunkType.toLowerCase()

  if (value.includes("start_step")) return "chunk.start_step"
  if (value === "start") return "chunk.start"
  if (value.includes("finish_step")) return "chunk.finish_step"
  if (value === "finish") return "chunk.finish"

  if (value.includes("reasoning_start")) return "chunk.reasoning_start"
  if (value.includes("reasoning_delta")) return "chunk.reasoning_delta"
  if (value.includes("reasoning_end")) return "chunk.reasoning_end"

  if (value.includes("action_input_start") || value.includes("tool_input_start")) {
    return "chunk.action_input_start"
  }
  if (value.includes("action_input_delta") || value.includes("tool_input_delta")) {
    return "chunk.action_input_delta"
  }
  if (
    value.includes("action_input_available") ||
    value.includes("tool_input_available") ||
    value.includes("action_call")
  ) {
    return "chunk.action_input_available"
  }
  if (value.includes("action_output_available") || value.includes("tool_output_available")) {
    return "chunk.action_output_available"
  }
  if (value.includes("action_output_error") || value.includes("tool_output_error")) {
    return "chunk.action_output_error"
  }

  if (value.includes("message_metadata")) return "chunk.message_metadata"
  if (value.includes("response_metadata")) return "chunk.response_metadata"

  if (value.includes("text_start")) return "chunk.text_start"
  if (value.includes("text_delta") || (value.includes("message") && value.includes("delta"))) {
    return "chunk.text_delta"
  }
  if (value.includes("text_end")) return "chunk.text_end"

  if (value.includes("source_url")) return "chunk.source_url"
  if (value.includes("source_document")) return "chunk.source_document"
  if (value.includes("file")) return "chunk.file"
  if (value.includes("error")) return "chunk.error"
  return "chunk.unknown"
}

function normalizeLower(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

function isActionItemType(itemType: string): boolean {
  if (!itemType) return false
  if (itemType === "agentmessage") return false
  if (itemType === "reasoning") return false
  if (itemType === "usermessage") return false
  return (
    itemType.includes("commandexecution") ||
    itemType.includes("filechange") ||
    itemType.includes("mcptoolcall") ||
    itemType.includes("tool") ||
    itemType.includes("action")
  )
}

function resolveActionRef(params: AnyRecord, item: AnyRecord): string | undefined {
  const fromParams =
    asString(params.itemId) ||
    asString(params.toolCallId) ||
    asString(params.id)
  if (fromParams) return fromParams
  const fromItem = asString(item.id) || asString(item.toolCallId)
  if (fromItem) return fromItem
  return undefined
}

export function mapCodexAppServerNotification(
  providerChunk: unknown,
): CodexChunkMappingResult | null {
  const chunk = asRecord(providerChunk)
  const method = asString(chunk.method).trim()
  if (!method) return null

  if (method.startsWith("codex/event/")) {
    return {
      chunkType: "chunk.unknown",
      providerChunkType: method,
      data: toJsonSafe({
        ignored: true,
        reason: "legacy_channel_disabled",
        method,
      }),
      raw: toJsonSafe(providerChunk),
      skip: true,
    }
  }

  const params = asRecord(chunk.params)
  const item = asRecord(params.item)
  const itemType = normalizeLower(item.type)
  const itemStatus = normalizeLower(item.status)
  const actionRef = resolveActionRef(params, item)
  const hasItemError = Boolean(item.error)

  const mappedData = toJsonSafe({
    method,
    params,
  })

  const map = (chunkType: ContextStreamChunkType): CodexChunkMappingResult => ({
    chunkType,
    providerChunkType: method,
    actionRef: chunkType.startsWith("chunk.action_") ? actionRef : undefined,
    data: mappedData,
    raw: toJsonSafe(providerChunk),
  })

  switch (method) {
    case "turn/started":
      return map("chunk.start")
    case "turn/completed":
      return map("chunk.finish")
    case "thread/tokenUsage/updated":
      return map("chunk.response_metadata")
    case "thread/status/changed":
    case "thread/started":
      return map("chunk.message_metadata")
    case "turn/diff/updated":
    case "turn/plan/updated":
    case PROVIDER_USAGE_UPDATED:
    case "account/rateLimits/updated":
      return map("chunk.response_metadata")
    case PROVIDER_STARTED:
    case PROVIDER_ARCHIVED:
    case PROVIDER_UNARCHIVED:
    case PROVIDER_NAME_UPDATED:
    case "account/updated":
    case "app/list/updated":
    case "authStatusChange":
    case "sessionConfigured":
    case "loginChatGptComplete":
    case "mcpServer/oauthLogin/completed":
      return map("chunk.message_metadata")
    case "item/agentMessage/delta":
      return map("chunk.text_delta")
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return map("chunk.reasoning_delta")
    case "item/reasoning/summaryPartAdded":
      return map("chunk.reasoning_start")
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress":
      return map("chunk.action_output_available")
    case "item/started": {
      if (itemType === "agentmessage") return map("chunk.text_start")
      if (itemType === "reasoning") return map("chunk.reasoning_start")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) return map("chunk.action_input_available")
      return map("chunk.message_metadata")
    }
    case "item/completed": {
      if (itemType === "agentmessage") return map("chunk.text_end")
      if (itemType === "reasoning") return map("chunk.reasoning_end")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) {
        if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
          return map("chunk.action_output_error")
        }
        return map("chunk.action_output_available")
      }
      if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
        return map("chunk.error")
      }
      return map("chunk.message_metadata")
    }
    case "error":
      return map("chunk.error")
    default:
      if (method.startsWith("item/") || method.startsWith("turn/")) {
        return map("chunk.response_metadata")
      }
      if (method.startsWith(PROVIDER_SCOPE_PREFIX) || method.startsWith("account/")) {
        return map("chunk.message_metadata")
      }
      return map("chunk.unknown")
  }
}

export function defaultMapCodexChunk(providerChunk: unknown): CodexChunkMappingResult {
  const appServerMapped = mapCodexAppServerNotification(providerChunk)
  if (appServerMapped) {
    return appServerMapped
  }

  const chunk = asRecord(providerChunk)
  const providerChunkType = asString(chunk.type) || "unknown"
  const actionRef = asString(chunk.actionRef) || asString(chunk.toolCallId) || asString(chunk.id) || undefined

  return {
    chunkType: mapCodexChunkType(providerChunkType),
    providerChunkType,
    actionRef,
    data: toJsonSafe({
      id: chunk.id,
      delta: chunk.delta,
      text: chunk.text,
      finishReason: chunk.finishReason,
      actionName: chunk.actionName,
      toolName: chunk.toolName,
      toolCallId: chunk.toolCallId,
    }),
    raw: toJsonSafe(providerChunk),
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return n
}

function getNestedRecord(source: unknown, key: string): AnyRecord | undefined {
  const record = asRecord(source)
  const nested = record[key]
  if (!nested || typeof nested !== "object") return undefined
  return asRecord(nested)
}

function extractUsageMetrics(usageSource: unknown) {
  const usage = asRecord(usageSource)
  const promptTokens =
    asFiniteNumber(usage.promptTokens) ??
    asFiniteNumber(usage.prompt_tokens) ??
    asFiniteNumber(usage.inputTokens) ??
    asFiniteNumber(usage.input_tokens) ??
    0

  const completionTokens =
    asFiniteNumber(usage.completionTokens) ??
    asFiniteNumber(usage.completion_tokens) ??
    asFiniteNumber(usage.outputTokens) ??
    asFiniteNumber(usage.output_tokens) ??
    0

  const totalTokens =
    asFiniteNumber(usage.totalTokens) ??
    asFiniteNumber(usage.total_tokens) ??
    promptTokens + completionTokens

  const promptDetails = getNestedRecord(usage, "prompt_tokens_details")
  const inputDetails = getNestedRecord(usage, "input_tokens_details")
  const cachedPromptTokens =
    asFiniteNumber(usage.promptTokensCached) ??
    asFiniteNumber(usage.cached_prompt_tokens) ??
    asFiniteNumber(promptDetails?.cached_tokens) ??
    asFiniteNumber(inputDetails?.cached_tokens) ??
    0

  const promptTokensUncached = Math.max(0, promptTokens - cachedPromptTokens)

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptTokensCached: cachedPromptTokens,
    promptTokensUncached,
  }
}

function asUnknownArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value)
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      out[key] = entry
    }
  }
  return out
}

function isValidProviderContextId(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true
  return false
}

function normalizeAppServerBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "")
  if (trimmed.endsWith("/turn")) return trimmed.slice(0, -"/turn".length)
  if (trimmed.endsWith("/rpc")) return trimmed.slice(0, -"/rpc".length)
  if (trimmed.endsWith("/events")) return trimmed.slice(0, -"/events".length)
  return trimmed
}

function parseSseDataBlock(block: string): string | null {
  const lines = block.split("\n").map((line) => line.trimEnd())
  const dataLines = lines.filter((line) => line.startsWith("data:"))
  if (!dataLines.length) return null
  return dataLines.map((line) => line.replace(/^data:\s*/, "")).join("\n")
}

function shellSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

function stripProviderControlChars(value: string): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
}

function parseSandboxJsonl(stdout: string): { events: AnyRecord[]; result: AnyRecord } {
  const events: AnyRecord[] = []
  let result: AnyRecord = {}
  for (const rawLine of stripProviderControlChars(stdout).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith("EKAIROS_CODEX_")) continue
    const tab = line.indexOf("\t")
    if (tab === -1) continue
    const prefix = line.slice(0, tab)
    const payload = asRecord(JSON.parse(line.slice(tab + 1)))
    if (prefix === "EKAIROS_CODEX_EVENT") events.push(payload)
    if (prefix === "EKAIROS_CODEX_RESULT") result = payload
  }
  return { events, result }
}

function codexSandboxBridgeScript(): string {
  return String.raw`
import http from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.CODEX_BRIDGE_PORT || "4500");
function asRecord(value) { return value && typeof value === "object" ? value : {}; }
function asString(value) { return typeof value === "string" ? value : value == null ? "" : String(value); }
const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const rl = createInterface({ input: child.stdout });
const pending = new Map();
const subscribers = new Set();
let initialized = false;

function notifyAll(payload) {
  const data = "data: " + JSON.stringify(payload) + "\n\n";
  for (const res of subscribers) {
    try { res.write(data); } catch { subscribers.delete(res); }
  }
}
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg && msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      const err = asRecord(msg.error);
      p.reject(new Error(asString(err.message) || asString(msg.error) || "rpc_error"));
    } else {
      p.resolve(msg);
    }
    return;
  }
  notifyAll(msg);
});
function sendRpc(payload, timeoutMs = 60000) {
  const id = payload.id || randomUUID();
  const msg = { ...payload, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("rpc_timeout:" + asString(payload.method)));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify(msg) + "\n");
  });
}
async function ensureInitialized() {
  if (initialized) return;
  await sendRpc({ method: "initialize", params: { clientInfo: { name: "ekairos-sandbox", version: "1.0.0" }, capabilities: {} } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  initialized = true;
}
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, initialized }));
    return;
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("data: " + JSON.stringify({ type: "ready" }) + "\n\n");
    subscribers.add(res);
    req.on("close", () => subscribers.delete(res));
    return;
  }
  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        await ensureInitialized();
        const payload = body ? JSON.parse(body) : {};
        const out = await sendRpc(payload);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (error) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: asString(error?.message || error) }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
child.on("exit", () => process.exit(1));
server.listen(PORT, "127.0.0.1", async () => {
  try { await ensureInitialized(); } catch {}
  console.log("[codex-bridge] listening http://127.0.0.1:" + PORT);
});
`
}

function codexSandboxTurnRunnerScript(): string {
  return String.raw`
import { readFileSync } from "node:fs";
const baseUrl = (process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:4500").replace(/\/+$/, "");
const instruction = process.env.CODEX_INSTRUCTION_FILE
  ? readFileSync(process.env.CODEX_INSTRUCTION_FILE, "utf8")
  : process.env.CODEX_INSTRUCTION || "";
const repoPath = process.env.CODEX_REPO_PATH || process.cwd();
const providerContextId = process.env.CODEX_PROVIDER_CONTEXT_ID || "";
const model = process.env.CODEX_MODEL || "";
function asRecord(value) { return value && typeof value === "object" ? value : {}; }
function asString(value) { return typeof value === "string" ? value : value == null ? "" : String(value); }
function emit(prefix, payload) { process.stdout.write(prefix + "\t" + JSON.stringify(payload) + "\n"); }
async function rpc(method, params) {
  const res = await fetch(baseUrl + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(asString(json.error) || "rpc_failed:" + method);
  return json;
}
function parseSse(block) {
  const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.startsWith("data:"));
  if (!lines.length) return null;
  return lines.map((line) => line.replace(/^data:\s*/, "")).join("\n");
}
let threadId = providerContextId;
let turnId = "";
let assistantText = "";
let reasoningText = "";
let diff = "";
let usage = {};
let completedTurn = {};
const eventsResponse = await fetch(baseUrl + "/events", { headers: { accept: "text/event-stream" } });
if (!eventsResponse.ok || !eventsResponse.body) throw new Error("events_unavailable:" + eventsResponse.status);
if (threadId) {
  await rpc("thread/resume", { threadId });
} else {
  const params = { cwd: repoPath, approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } };
  if (model) params.model = model;
  const started = await rpc("thread/start", params);
  threadId = asString(asRecord(asRecord(started.result).thread).id) || asString(asRecord(started.result).id) || asString(started.threadId);
}
if (!threadId) throw new Error("thread_id_missing");
const reader = eventsResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const turnParams = { threadId, input: [{ type: "text", text: instruction }], cwd: repoPath, approvalPolicy: "never", sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" } };
if (model) turnParams.model = model;
const turnStart = await rpc("turn/start", turnParams);
turnId = asString(asRecord(asRecord(turnStart.result).turn).id) || asString(asRecord(turnStart.result).id) || asString(turnStart.turnId);
let done = false;
while (!done) {
  const read = await reader.read();
  if (read.done) break;
  buffer += decoder.decode(read.value, { stream: true });
  const blocks = buffer.split("\n\n");
  buffer = blocks.pop() || "";
  for (const block of blocks) {
    const data = parseSse(block);
    if (!data || data === "[DONE]") continue;
    const evt = JSON.parse(data);
    const method = asString(evt.method);
    if (!method || method.startsWith("codex/event/")) continue;
    const params = asRecord(evt.params);
    const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id);
    const evtThreadId = asString(params.threadId) || asString(asRecord(params.turn).threadId);
    const scoped = (evtTurnId && turnId && evtTurnId === turnId) || (evtThreadId && evtThreadId === threadId) || method.startsWith("thread/") || method.startsWith("context/");
    if (!scoped) continue;
    emit("EKAIROS_CODEX_EVENT", evt);
    if (method === "turn/started" && !turnId) turnId = evtTurnId || asString(asRecord(params.turn).id);
    if (method === "item/agentMessage/delta") assistantText += asString(params.delta);
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") reasoningText += asString(params.delta);
    if (method === "turn/diff/updated") diff = asString(params.diff);
    if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") usage = asRecord(params.tokenUsage);
    if (method === "item/completed") {
      const item = asRecord(params.item);
      if (asString(item.type) === "agentMessage" && asString(item.text).trim()) assistantText = asString(item.text);
      if (asString(item.type) === "reasoning" && asString(item.summary).trim()) reasoningText = asString(item.summary);
    }
    if (method === "turn/completed") {
      completedTurn = asRecord(params.turn);
      done = true;
      break;
    }
    if (method === "turn/failed") throw new Error("turn_failed:" + (evtTurnId || turnId || "unknown"));
  }
}
await reader.cancel().catch(() => {});
emit("EKAIROS_CODEX_RESULT", { providerContextId: threadId, turnId: asString(completedTurn.id) || turnId, assistantText, reasoningText, diff, usage, completedTurn });
`
}

function ensureOk<T>(result: { ok: true; data: T } | { ok: false; error: string }, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`)
  return result.data
}

function previewUrlForPort(sandboxUrl: string, port: number): string {
  const base = String(sandboxUrl ?? "").trim()
  if (!base) return ""
  if (port === 8080) return base.replace(/\/+$/, "")
  try {
    const url = new URL(base)
    url.port = String(port)
    return url.toString().replace(/\/+$/, "")
  } catch {
    return base.replace(/\/+$/, "") + ":" + String(port)
  }
}

async function executeCodexSandboxTurn(
  args: CodexAppServerTurnStepArgs<CodexConfig>,
  helpers: {
    emitProviderChunk: (providerChunk: unknown) => Promise<void>
    streamTrace: () => CodexStreamTrace
  },
): Promise<CodexTurnResult> {
  const sandboxConfig = args.config.sandbox ?? {}
  const runtime = args.runtime as any
  if (!runtime || typeof runtime.use !== "function") {
    throw new Error("codex_sandbox_runtime_required")
  }

  const { sandboxDomain } = await import("@ekairos/sandbox")
  const scoped = await runtime.use(sandboxDomain)
  const actions = (scoped as any).actions
  if (!actions) throw new Error("codex_sandbox_actions_required")

  const codexHome = String(sandboxConfig.codexHome ?? "/home/sprite/.codex").trim() || "/home/sprite/.codex"
  const bridgePort = Math.max(1, Number(sandboxConfig.bridgePort ?? 4500))
  const appPort = Math.max(1, Number(sandboxConfig.appPort ?? 8080))
  const repoPath = String(args.config.repoPath || "/workspace/ekairos-app").trim() || "/workspace/ekairos-app"
  const workRoot = "/workspace/.ekairos/codex"
  const bridgePath = `${workRoot}/codex-bridge.mjs`
  const turnRunnerPath = `${workRoot}/codex-turn-runner.mjs`
  const instructionPath = `${workRoot}/instruction-${args.executionId}-${args.stepId}.txt`
  const checkpoints: Array<{ label: string; checkpointId: string }> = []

  let sandboxId = String(sandboxConfig.sandboxId ?? "").trim()
  if (!sandboxId) {
    const created = ensureOk(
      await actions.createSandbox({
        provider: sandboxConfig.provider ?? "sprites",
        runtime: sandboxConfig.runtime ?? "node22",
        purpose: sandboxConfig.purpose ?? "codex-reactor-sandbox",
        sprites: {
          name: sandboxConfig.spriteName,
          waitForCapacity: true,
          urlSettings: { auth: "public" },
          deleteOnStop: true,
        },
      }),
      "codex_sandbox_create",
    )
    sandboxId = String((created as any).sandboxId)
  }
  if (!sandboxId) throw new Error("codex_sandbox_id_missing")

  ensureOk(
    await actions.installCodexAuth({
      sandboxId,
      codexHome,
      authJsonPath: sandboxConfig.authJsonPath,
      credentialsJsonPath: sandboxConfig.credentialsJsonPath,
      configTomlPath: sandboxConfig.configTomlPath,
    }),
    "codex_sandbox_auth",
  )

  ensureOk(
    await actions.writeFiles({
      sandboxId,
      files: [
        {
          path: bridgePath,
          contentBase64: Buffer.from(codexSandboxBridgeScript(), "utf8").toString("base64"),
        },
        {
          path: turnRunnerPath,
          contentBase64: Buffer.from(codexSandboxTurnRunnerScript(), "utf8").toString("base64"),
        },
        {
          path: instructionPath,
          contentBase64: Buffer.from(args.instruction, "utf8").toString("base64"),
        },
      ],
    }),
    "codex_sandbox_write_files",
  )

  const runProcess = async (
    label: string,
    script: string,
    kind: "command" | "codex-app-server" | "dev-server" = "command",
    requiredText?: string,
  ) => {
    const result = ensureOk(
      await actions.runCommandProcess({
        sandboxId,
        command: "sh",
        args: ["-lc", script],
        kind,
        mode: "foreground",
        metadata: { source: "codex-reactor", label },
      }),
      label,
    )
    if (requiredText) {
      const output = stripProviderControlChars(
        `${asString(asRecord((result as any).result).output)}\n${asString(asRecord((result as any).result).error)}`,
      )
      if (!output.includes(requiredText)) {
        throw new Error(`${label}: missing_sentinel:${requiredText}:${output.slice(-1000)}`)
      }
    }
    return result
  }

  await runProcess(
    "codex_sandbox_prepare_codex",
    [
      "set -euo pipefail",
      `mkdir -p ${shellSingleQuote(codexHome)} ${shellSingleQuote(workRoot)}`,
      `chmod 700 ${shellSingleQuote(codexHome)} || true`,
      `chmod 600 ${shellSingleQuote(`${codexHome}/auth.json`)} 2>/dev/null || true`,
      "if ! command -v codex >/dev/null 2>&1; then npm i -g @openai/codex@latest; fi",
      `HOME=/home/sprite CODEX_HOME=${shellSingleQuote(codexHome)} codex login status`,
      "echo codex_sandbox_prepare_codex_ok",
    ].join("\n"),
    "command",
    "codex_sandbox_prepare_codex_ok",
  )

  if (sandboxConfig.checkpoint !== false) {
    const checkpoint = await actions.createCheckpoint({
      sandboxId,
      comment: "codex auth and cli ready",
    })
    if (checkpoint.ok) {
      checkpoints.push({ label: "codex-ready", checkpointId: String(checkpoint.data.checkpointId) })
    }
  }

  await runProcess(
    "codex_sandbox_start_bridge",
    [
      "set -euo pipefail",
      `if ! curl -fsS http://127.0.0.1:${bridgePort}/health >/dev/null 2>&1; then`,
      `  HOME=/home/sprite CODEX_HOME=${shellSingleQuote(codexHome)} CODEX_BRIDGE_PORT=${bridgePort} nohup node ${shellSingleQuote(bridgePath)} > /tmp/ekairos-codex-bridge-${bridgePort}.log 2>&1 &`,
      `  echo $! > /tmp/ekairos-codex-bridge-${bridgePort}.pid`,
      "fi",
      `for i in $(seq 1 90); do curl -fsS http://127.0.0.1:${bridgePort}/health >/dev/null 2>&1 && echo codex_sandbox_bridge_ok && exit 0; sleep 1; done`,
      `cat /tmp/ekairos-codex-bridge-${bridgePort}.log || true`,
      "exit 1",
    ].join("\n"),
    "codex-app-server",
    "codex_sandbox_bridge_ok",
  )

  if (sandboxConfig.createApp) {
    const createdApp = ensureOk(
      await actions.createEkairosApp({
        sandboxId,
        appDir: repoPath,
        packageManager: "pnpm",
        instantTokenEnvName: "INSTANT_PERSONAL_ACCESS_TOKEN",
      }),
      "codex_sandbox_create_app",
    )
    const createdAppOutput = stripProviderControlChars(asString(asRecord((createdApp as any).result).output))
    if (!createdAppOutput.includes("sandbox_create_ekairos_app_ok")) {
      throw new Error(`codex_sandbox_create_app: missing_sentinel:${createdAppOutput.slice(-1000)}`)
    }
  }

  if (sandboxConfig.installApp) {
    await runProcess(
      "codex_sandbox_install_app",
      [
        "set -euo pipefail",
        `cd ${shellSingleQuote(repoPath)}`,
        "for i in 1 2 3; do npx -y pnpm@10.15.1 install && break; echo pnpm_install_retry_$i; sleep 20; done",
        "test -x node_modules/.bin/next",
        "echo codex_sandbox_install_app_ok",
      ].join("\n"),
      "command",
      "codex_sandbox_install_app_ok",
    )
  }

  let appBaseUrl = ""
  if (sandboxConfig.startApp) {
    await runProcess(
      "codex_sandbox_start_app",
      [
        "set -euo pipefail",
        `cd ${shellSingleQuote(repoPath)}`,
        `if ! curl -fsS http://127.0.0.1:${appPort}/api/ekairos/domain >/dev/null 2>&1; then`,
        `  nohup npx -y pnpm@10.15.1 dev --hostname 0.0.0.0 --port ${appPort} > /tmp/ekairos-app-${appPort}.log 2>&1 &`,
        `  echo $! > /tmp/ekairos-app-${appPort}.pid`,
        "fi",
        `for i in $(seq 1 180); do curl -fsS http://127.0.0.1:${appPort}/api/ekairos/domain >/dev/null 2>&1 && echo codex_sandbox_start_app_ok && exit 0; sleep 1; done`,
        `cat /tmp/ekairos-app-${appPort}.log || true`,
        "exit 1",
      ].join("\n"),
      "dev-server",
      "codex_sandbox_start_app_ok",
    )
    const sandboxRecord = ensureOk(await actions.getSandbox({ sandboxId }), "codex_sandbox_get")
    appBaseUrl = previewUrlForPort(String((sandboxRecord as any).sandboxUrl ?? ""), appPort)
    if (appBaseUrl) {
      const response = await fetch(`${appBaseUrl}/api/ekairos/domain`)
      if (!response.ok) throw new Error(`codex_sandbox_app_url_unavailable_${response.status}`)
    }
  }

  if (sandboxConfig.checkpoint !== false && (sandboxConfig.createApp || sandboxConfig.installApp || sandboxConfig.startApp)) {
    const checkpoint = await actions.createCheckpoint({
      sandboxId,
      comment: "codex reactor app ready",
    })
    if (checkpoint.ok) {
      checkpoints.push({ label: "app-ready", checkpointId: String(checkpoint.data.checkpointId) })
    }
  }

  const turnRun = await runProcess(
    "codex_sandbox_turn",
    [
      "set -euo pipefail",
      `timeout 300s env HOME=/home/sprite CODEX_HOME=${shellSingleQuote(codexHome)} CODEX_BRIDGE_URL=http://127.0.0.1:${bridgePort} CODEX_REPO_PATH=${shellSingleQuote(repoPath)} CODEX_INSTRUCTION_FILE=${shellSingleQuote(instructionPath)} CODEX_PROVIDER_CONTEXT_ID=${shellSingleQuote(args.config.providerContextId ?? "")} CODEX_MODEL=${shellSingleQuote(args.config.model ?? "")} node ${shellSingleQuote(turnRunnerPath)}`,
    ].join("\n"),
    "codex-app-server",
  )

  const result = asRecord((turnRun as any).result)
  const stdout = asString(result.output)
  const parsed = parseSandboxJsonl(stdout)
  for (const evt of parsed.events) {
    await helpers.emitProviderChunk(evt)
  }
  const finalResult = parsed.result

  return {
    providerContextId: asString(finalResult.providerContextId) || asString(args.config.providerContextId),
    turnId: asString(finalResult.turnId),
    assistantText: asString(finalResult.assistantText),
    reasoningText: asString(finalResult.reasoningText),
    diff: asString(finalResult.diff),
    toolParts: asUnknownArray(asRecord(finalResult.completedTurn).toolParts),
    usage: asRecord(finalResult.usage),
    metadata: {
      provider: "codex-sandbox",
      sandbox: {
        sandboxId,
        repoPath,
        appBaseUrl,
        bridgePort,
        appPort,
        processId: asString((turnRun as any).processId),
        streamId: asString((turnRun as any).streamId),
        streamClientId: asString((turnRun as any).streamClientId),
        checkpoints,
      },
      providerResponse: finalResult,
      streamTrace: helpers.streamTrace(),
    },
  }
}

async function readJsonResponse(response: Response): Promise<AnyRecord> {
  const text = await response.text().catch(() => "")
  if (!text.trim()) return {}
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

async function codexAppServerRpc<T = AnyRecord>(
  baseUrl: string,
  method: string,
  params: AnyRecord,
): Promise<T> {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    const error = asString(payload.error) || asString(asRecord(payload.error).message)
    throw new Error(error || `codex_rpc_http_${response.status}`)
  }
  if (payload.error) {
    const error = asString(payload.error) || asString(asRecord(payload.error).message)
    throw new Error(error || "codex_rpc_error")
  }
  return payload as T
}

export async function executeCodexAppServerTurnStep<
  Config extends CodexConfig = CodexConfig,
>(args: CodexAppServerTurnStepArgs<Config>): Promise<CodexTurnResult> {
  "use step"

  const baseUrl = normalizeAppServerBaseUrl(args.config.appServerUrl)
  if (!baseUrl) throw new Error("codex_app_server_url_required")

  let sequence = 0
  const mappedChunks: CodexMappedChunk[] = []
  const chunkTypeCounters = new Map<string, number>()
  const providerChunkTypeCounters = new Map<string, number>()
  const contextWriter = args.contextStepStream?.getWriter()
  const workflowWriter = args.writable?.getWriter()

  const emitProviderChunk = async (providerChunk: unknown) => {
    const mapped = defaultMapCodexChunk(providerChunk)
    if (!mapped || mapped.skip) return

    sequence += 1
    const mappedChunk: CodexMappedChunk = {
      at: new Date().toISOString(),
      sequence,
      chunkType: mapped.chunkType,
      providerChunkType: mapped.providerChunkType,
      actionRef: mapped.actionRef,
      data: mapped.data,
      raw: mapped.raw ?? toJsonSafe(providerChunk),
    }
    mappedChunks.push(mappedChunk)
    chunkTypeCounters.set(
      mappedChunk.chunkType,
      (chunkTypeCounters.get(mappedChunk.chunkType) ?? 0) + 1,
    )
    const providerType = mappedChunk.providerChunkType || "unknown"
    providerChunkTypeCounters.set(
      providerType,
      (providerChunkTypeCounters.get(providerType) ?? 0) + 1,
    )

    const payload: CodexEmitPayload = {
      at: mappedChunk.at,
      sequence,
      chunkType: mappedChunk.chunkType,
      provider: "codex",
      providerChunkType: mappedChunk.providerChunkType,
      actionRef: mappedChunk.actionRef,
      data: mappedChunk.data,
      raw: mappedChunk.raw,
    }

    await contextWriter?.write(
      encodeContextStepStreamChunk(createContextStepStreamChunk(payload)),
    )
    await workflowWriter?.write({
      type: "data-chunk.emitted",
      data: {
        type: "chunk.emitted",
        contextId: args.contextId,
        executionId: args.executionId,
        stepId: args.stepId,
        itemId: args.eventId,
        ...payload,
      },
    } as any)
  }

  const streamTrace = () => ({
    totalChunks: mappedChunks.length,
    chunkTypes: Object.fromEntries(chunkTypeCounters.entries()),
    providerChunkTypes: Object.fromEntries(providerChunkTypeCounters.entries()),
    chunks: mappedChunks,
  })

  try {
    if (args.config.mode === "sandbox" || args.config.sandbox) {
      return await executeCodexSandboxTurn(args as CodexAppServerTurnStepArgs<CodexConfig>, {
        emitProviderChunk,
        streamTrace,
      })
    }

    if (String(args.config.appServerUrl || "").trim().replace(/\/+$/, "").endsWith("/turn")) {
      const response = await fetch(args.config.appServerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: args.instruction,
          config: args.config,
          runtime: { source: "openai-reactor" },
        }),
      })
      const payload = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(asString(payload.error) || `codex_turn_http_${response.status}`)
      }
      for (const chunk of asUnknownArray(payload.stream)) {
        await emitProviderChunk(chunk)
      }
      return {
        providerContextId:
          asString(payload.providerContextId) ||
          asString(payload.contextId) ||
          asString(args.config.providerContextId),
        turnId: asString(payload.turnId),
        assistantText: asString(payload.assistantText) || asString(payload.text),
        reasoningText: asString(payload.reasoningText) || asString(payload.reasoning),
        diff: asString(payload.diff),
        toolParts: asUnknownArray(payload.toolParts),
        usage: asRecord(payload.usage),
        metadata: {
          provider: "codex-app-server",
          response: payload,
          streamTrace: streamTrace(),
        },
      }
    }

    const eventsResponse = await fetch(`${baseUrl}/events`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
    })
    if (!eventsResponse.ok || !eventsResponse.body) {
      throw new Error(`codex_events_unavailable_${eventsResponse.status}`)
    }

    const requestedThreadId = asString(args.config.providerContextId).trim()
    let providerContextId = requestedThreadId
    if (providerContextId && isValidProviderContextId(providerContextId)) {
      await codexAppServerRpc(baseUrl, "thread/resume", { threadId: providerContextId })
    } else {
      const startParams: AnyRecord = {
        cwd: args.config.repoPath,
        approvalPolicy: args.config.approvalPolicy ?? "never",
        sandboxPolicy:
          args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
            ? args.config.sandboxPolicy
            : { type: "externalSandbox", networkAccess: "enabled" },
      }
      if (args.config.model) startParams.model = args.config.model
      const started = await codexAppServerRpc(baseUrl, "thread/start", startParams)
      providerContextId =
        asString(asRecord(asRecord(started.result).thread).id) ||
        asString(asRecord(started.result).id) ||
        asString(started.threadId)
    }
    if (!providerContextId) throw new Error("codex_thread_id_missing")

    const turnParams: AnyRecord = {
      threadId: providerContextId,
      input: [{ type: "text", text: args.instruction }],
      cwd: args.config.repoPath,
      approvalPolicy: args.config.approvalPolicy ?? "never",
      sandboxPolicy:
        args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
          ? args.config.sandboxPolicy
          : { type: "externalSandbox", networkAccess: "enabled" },
    }
    if (args.config.model) turnParams.model = args.config.model
    const turnStart = await codexAppServerRpc(baseUrl, "turn/start", turnParams)
    let turnId =
      asString(asRecord(asRecord(turnStart.result).turn).id) ||
      asString(asRecord(turnStart.result).id) ||
      asString(turnStart.turnId)

    const reader = eventsResponse.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let assistantText = ""
    let reasoningText = ""
    let diff = ""
    let usage: AnyRecord = {}
    let completedTurn: AnyRecord = {}

    try {
      while (true) {
        const read = await reader.read()
        if (read.done) break
        if (!read.value) continue
        buffer += decoder.decode(read.value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""
        for (const block of blocks) {
          const data = parseSseDataBlock(block)
          if (!data || data === "[DONE]") continue
          const evt = asRecord(JSON.parse(data))
          const method = asString(evt.method)
          if (!method) continue
          const params = asRecord(evt.params)
          const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id)
          const evtThreadId =
            asString(params.threadId) ||
            asString(params.providerContextId) ||
            asString(asRecord(params.turn).threadId) ||
            asString(asRecord(params.turn).providerContextId)
          const scopedToTurn =
            (evtTurnId && turnId && evtTurnId === turnId) ||
            (evtThreadId && evtThreadId === providerContextId) ||
            method.startsWith("thread/") ||
            method.startsWith("context/")
          if (!scopedToTurn) continue

          await emitProviderChunk(evt)

          if (method === "turn/started" && !turnId) {
            turnId = asString(asRecord(params.turn).id) || evtTurnId
          }
          if (method === "item/agentMessage/delta") {
            assistantText += asString(params.delta)
          }
          if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
            reasoningText += asString(params.delta)
          }
          if (method === "turn/diff/updated") {
            diff = asString(params.diff)
          }
          if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") {
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
            completedTurn = asRecord(params.turn)
            return {
              providerContextId,
              turnId: asString(completedTurn.id) || turnId,
              assistantText,
              reasoningText,
              diff,
              toolParts: asUnknownArray(completedTurn.toolParts),
              usage,
              metadata: {
                provider: "codex-app-server",
                providerResponse: completedTurn,
                streamTrace: streamTrace(),
              },
            }
          }
          if (method === "turn/failed") {
            throw new Error(`codex_turn_failed_${evtTurnId || turnId || "unknown"}`)
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }

    throw new Error("codex_turn_completion_missing")
  } finally {
    contextWriter?.releaseLock()
    workflowWriter?.releaseLock()
  }
}

/**
 * Codex App Server reactor for @ekairos/events.
 *
 * This maps one Context loop iteration to one Codex turn and returns a persisted
 * assistant event compatible with the Context engine.
 *
 * Workflow compatibility:
 * - `resolveConfig` and `executeTurn` should be implemented with `"use step"`
 *   wrappers when they perform I/O.
 */
export function createCodexReactor<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
>( 
  options: CreateCodexReactorOptions<Context, Config, Env>,
): ContextReactor<Context, Env> {
  const toolName = asString(options.toolName).trim() || "codex"
  const includeReasoningPart = Boolean(options.includeReasoningPart)
  const includeStreamTraceInOutput =
    options.includeStreamTraceInOutput !== undefined
      ? Boolean(options.includeStreamTraceInOutput)
      : true
  const includeRawProviderChunksInOutput = Boolean(options.includeRawProviderChunksInOutput)
  const maxPersistedStreamChunks = Math.max(0, Number(options.maxPersistedStreamChunks ?? 300))

  return async (
    params: ContextReactorParams<Context, Env>,
  ): Promise<ContextReactionResult> => {
    let chunkSequence = 0
    const chunkTypeCounters = new Map<string, number>()
    const providerChunkTypeCounters = new Map<string, number>()
    const capturedChunks: CodexMappedChunk[] = []
    const allCapturedChunks: CodexMappedChunk[] = []
    const semanticChunks: AnyRecord[] = []

    const context = asRecord(params.context.content)
    const instruction = (
      options.buildInstruction
        ? await options.buildInstruction({
            env: params.env,
            context,
            triggerEvent: params.triggerEvent,
          })
        : defaultInstructionFromTrigger(params.triggerEvent)
    ).trim()

    const config = await options.resolveConfig({
      env: params.env,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      eventId: params.eventId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
    })

    const startedAtMs = Date.now()
    let streamedAssistantText = ""
    let streamedReasoningText = ""
    let streamedDiff = ""
    let streamedProviderContextId = asString(config.providerContextId)
    let streamedTurnId = ""

    function maybeCaptureSemanticChunk(mappedChunk: CodexMappedChunk) {
      const mappedData = asRecord(mappedChunk.data)
      const mappedMethod = asString(mappedData.method)
      if (
        mappedMethod !== "item/started" &&
        mappedMethod !== "item/completed" &&
        mappedMethod !== "thread/tokenUsage/updated" &&
        mappedMethod !== "context/tokenUsage/updated" &&
        mappedMethod !== "turn/completed" &&
        mappedMethod !== "turn/diff/updated"
      ) {
        return
      }
      semanticChunks.push({
        at: mappedChunk.at,
        sequence: mappedChunk.sequence,
        chunkType: mappedChunk.chunkType,
        providerChunkType: mappedChunk.providerChunkType,
        data: mappedChunk.data,
      })
    }

    const persistCompletedReactionParts = async () => {
      if (!params.persistReactionParts) return
      const completedParts = buildCodexParts({
        toolName,
        includeReasoningPart,
        completedOnly: true,
        semanticChunks,
        rawChunks: allCapturedChunks,
        result: {
          providerContextId: streamedProviderContextId,
          turnId: streamedTurnId,
          assistantText: streamedAssistantText,
          reasoningText: streamedReasoningText,
          diff: streamedDiff,
        },
        instruction,
        streamTrace: {
          totalChunks: chunkSequence,
          chunkTypes: Object.fromEntries(chunkTypeCounters.entries()),
          providerChunkTypes: Object.fromEntries(providerChunkTypeCounters.entries()),
          chunks: capturedChunks,
        },
      })
      await params.persistReactionParts(completedParts)
    }

    const emitChunk = async (providerChunk: unknown) => {
      const mapped = options.mapChunk
        ? options.mapChunk(providerChunk)
        : defaultMapCodexChunk(providerChunk)
      if (!mapped || mapped.skip) return
      const now = new Date().toISOString()
      chunkSequence += 1

      const mappedChunk: CodexMappedChunk = {
        at: now,
        sequence: chunkSequence,
        chunkType: mapped.chunkType,
        providerChunkType: mapped.providerChunkType,
        actionRef: mapped.actionRef,
        data: mapped.data,
        raw: includeRawProviderChunksInOutput
          ? mapped.raw ?? toJsonSafe(providerChunk)
          : undefined,
      }
      allCapturedChunks.push({
        ...mappedChunk,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
      })

      chunkTypeCounters.set(
        mapped.chunkType,
        (chunkTypeCounters.get(mapped.chunkType) ?? 0) + 1,
      )
      const providerType = mapped.providerChunkType || "unknown"
      providerChunkTypeCounters.set(
        providerType,
        (providerChunkTypeCounters.get(providerType) ?? 0) + 1,
      )
      if (includeStreamTraceInOutput && capturedChunks.length < maxPersistedStreamChunks) {
        capturedChunks.push(mappedChunk)
      }
      maybeCaptureSemanticChunk(mappedChunk)

      const mappedData = asRecord(mappedChunk.data)
      const mappedParams = asRecord(mappedData.params)
      const mappedItem = asRecord(mappedParams.item)
      const mappedTurn = asRecord(mappedParams.turn)
      streamedProviderContextId =
        asString(
          mappedParams.threadId ||
            mappedParams.providerContextId ||
            mappedTurn.threadId ||
            mappedTurn.providerContextId,
        ) || streamedProviderContextId
      streamedTurnId =
        asString(mappedParams.turnId || mappedTurn.id) || streamedTurnId

      const mappedMethod = asString(mappedData.method)
      if (mappedMethod === "item/agentMessage/delta") {
        streamedAssistantText += asString(mappedParams.delta)
      }
      if (
        mappedMethod === "item/reasoning/summaryTextDelta" ||
        mappedMethod === "item/reasoning/textDelta"
      ) {
        streamedReasoningText += asString(mappedParams.delta)
      }
      if (mappedMethod === "turn/diff/updated") {
        streamedDiff = asString(mappedParams.diff)
      }
      if (mappedMethod === "item/completed" && asString(mappedItem.type) === "agentMessage") {
        streamedAssistantText = asString(mappedItem.text || streamedAssistantText)
      }
      if (mappedMethod === "item/completed" && asString(mappedItem.type) === "reasoning") {
        streamedReasoningText = asString(mappedItem.summary || streamedReasoningText)
      }

      if (options.onMappedChunk) {
        try {
          await options.onMappedChunk(mappedChunk, params)
        } catch {
          // hooks are non-critical
        }
      }

      if (mappedMethod === "item/completed" || mappedMethod === "turn/completed") {
        await persistCompletedReactionParts()
      }

      const payload: CodexEmitPayload = {
        at: now,
        sequence: mappedChunk.sequence,
        chunkType: mappedChunk.chunkType,
        provider: "codex",
        providerChunkType: mappedChunk.providerChunkType,
        actionRef: mappedChunk.actionRef,
        data: mappedChunk.data,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
      }

      if (params.contextStepStream) {
        const writer = params.contextStepStream.getWriter()
        try {
          await writer.write(
            encodeContextStepStreamChunk(
              createContextStepStreamChunk(payload),
            ),
          )
        } finally {
          writer.releaseLock()
        }
      }

      if (params.writable) {
        const writer = params.writable.getWriter()
        try {
          await writer.write({
            type: "data-chunk.emitted",
            data: {
              type: "chunk.emitted",
              contextId: params.contextId,
              executionId: params.executionId,
              stepId: params.stepId,
              itemId: params.eventId,
              ...payload,
            },
          })
        } finally {
          writer.releaseLock()
        }
      }
    }

    const turn = options.executeTurn
      ? await options.executeTurn({
        env: params.env,
        runtime: params.runtime,
        context,
        triggerEvent: params.triggerEvent,
        contextId: params.contextId,
        eventId: params.eventId,
        executionId: params.executionId,
        stepId: params.stepId,
        iteration: params.iteration,
        instruction,
        config,
        skills: params.skills,
        contextStepStream: params.contextStepStream,
        writable: params.writable,
        silent: params.silent,
        emitChunk,
      })
      : await executeCodexAppServerTurnStep({
          config,
          env: params.env,
          runtime: params.runtime,
          instruction,
          contextId: params.contextId,
          eventId: params.eventId,
          executionId: params.executionId,
          stepId: params.stepId,
          contextStepStream: params.contextStepStream,
          writable: params.writable as WritableStream<unknown> | undefined,
          silent: params.silent,
        })
    const finishedAtMs = Date.now()
    const returnedStreamTrace = asRecord(asRecord(turn.metadata).streamTrace)
    const returnedChunks = Array.isArray(returnedStreamTrace.chunks)
      ? (returnedStreamTrace.chunks as CodexMappedChunk[])
      : []
    const effectiveRawChunks = allCapturedChunks.length > 0 ? allCapturedChunks : returnedChunks
    const effectiveSemanticChunks = semanticChunks.length > 0 ? semanticChunks : returnedChunks
    const returnedChunkTypes = asNumberRecord(returnedStreamTrace.chunkTypes)
    const returnedProviderChunkTypes = asNumberRecord(returnedStreamTrace.providerChunkTypes)
    const returnedTotalChunks =
      typeof returnedStreamTrace.totalChunks === "number"
        ? returnedStreamTrace.totalChunks
        : returnedChunks.length

    const streamTrace: CodexStreamTrace | undefined = includeStreamTraceInOutput
      ? {
          totalChunks: chunkSequence || returnedTotalChunks,
          chunkTypes:
            chunkSequence > 0
              ? Object.fromEntries(chunkTypeCounters.entries())
              : returnedChunkTypes,
          providerChunkTypes:
            chunkSequence > 0
              ? Object.fromEntries(providerChunkTypeCounters.entries())
              : returnedProviderChunkTypes,
        }
      : undefined

    const usagePayload = toJsonSafe(turn.usage ?? asRecord(turn.metadata).usage)
    const usageMetrics = extractUsageMetrics(usagePayload)

    const assistantEvent: ContextItem = {
      id: params.eventId,
      type: OUTPUT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: buildCodexParts({
          toolName,
          includeReasoningPart,
          semanticChunks: effectiveSemanticChunks,
          rawChunks: effectiveRawChunks,
          result: turn,
          instruction,
          streamTrace,
        }),
      },
    }

    return {
      assistantEvent,
      actionRequests: [],
      messagesForModel: [],
      llm: {
        provider: "codex",
        model: asString(config.model || "codex"),
        promptTokens: usageMetrics.promptTokens,
        promptTokensCached: usageMetrics.promptTokensCached,
        promptTokensUncached: usageMetrics.promptTokensUncached,
        completionTokens: usageMetrics.completionTokens,
        totalTokens: usageMetrics.totalTokens,
        latencyMs: Math.max(0, finishedAtMs - startedAtMs),
        rawUsage: usagePayload,
        rawProviderMetadata: toJsonSafe({
          providerContextId: turn.providerContextId,
          turnId: turn.turnId,
          metadata: turn.metadata ?? null,
          streamTrace: streamTrace
            ? {
                totalChunks: streamTrace.totalChunks,
                chunkTypes: streamTrace.chunkTypes,
                providerChunkTypes: streamTrace.providerChunkTypes,
              }
            : undefined,
        }),
      },
    }
  }
}
