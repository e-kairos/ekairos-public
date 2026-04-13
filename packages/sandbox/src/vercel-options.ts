import type { SandboxConfig } from "./types.js"

export type VercelSandboxProfile = "ephemeral" | "coding-agent"

export type ResolvedVercelSandboxConfig = {
  profile: VercelSandboxProfile
  runtime: string
  timeoutMs: number
  ports: number[]
  vcpus: number
  name?: string
  reuse: boolean
  persistent: boolean
  deleteOnStop: boolean
  snapshotExpirationMs?: number
  tags?: Record<string, string>
}

const DEFAULT_EPHEMERAL_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_CODING_AGENT_TIMEOUT_MS = 20 * 60 * 1000
const DEFAULT_SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_VERCEL_TIMEOUT_MS = 5 * 60 * 60 * 1000
const MAX_VERCEL_VCPUS = 8
const MAX_VERCEL_PORTS = 15
const MAX_VERCEL_TAGS = 5

function parseOptionalBoolean(value: unknown): boolean | undefined {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function inferProfile(config: SandboxConfig, env: Record<string, unknown>): VercelSandboxProfile {
  const explicit = String(config.vercel?.profile ?? env.SANDBOX_VERCEL_PROFILE ?? "")
    .trim()
    .toLowerCase()
  if (explicit === "coding-agent" || explicit === "agent" || explicit === "codex") return "coding-agent"
  if (explicit === "ephemeral" || explicit === "cost") return "ephemeral"

  const purpose = String(config.purpose ?? "").toLowerCase()
  if (purpose.includes("codex") || purpose.includes("coding-agent") || purpose.includes("agent")) {
    return "coding-agent"
  }

  return "ephemeral"
}

function normalizePorts(ports: unknown): number[] {
  if (!Array.isArray(ports)) return []
  const normalized = ports
    .map((port) => Number(port))
    .filter((port) => Number.isFinite(port) && port > 0)
    .map((port) => Math.floor(port))
  return Array.from(new Set(normalized)).slice(0, MAX_VERCEL_PORTS)
}

function normalizeTagKey(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 64)
}

function normalizeTagValue(value: string): string {
  return value.trim().slice(0, 128)
}

function setTag(tags: Record<string, string>, key: string, value: unknown): void {
  if (Object.keys(tags).length >= MAX_VERCEL_TAGS) return
  const normalizedKey = normalizeTagKey(String(key ?? ""))
  const normalizedValue = normalizeTagValue(String(value ?? ""))
  if (!normalizedKey || !normalizedValue) return
  tags[normalizedKey] = normalizedValue
}

function resolveTags(
  config: SandboxConfig,
  resolved: Omit<ResolvedVercelSandboxConfig, "tags">,
  sandboxId?: string,
): Record<string, string> | undefined {
  const tags: Record<string, string> = {}
  setTag(tags, "ekairos", "1")
  setTag(tags, "profile", resolved.profile)
  if (config.purpose) setTag(tags, "purpose", config.purpose)
  if (sandboxId) setTag(tags, "sandboxId", sandboxId)

  for (const [key, value] of Object.entries(config.vercel?.tags ?? {})) {
    setTag(tags, key, value)
  }

  return Object.keys(tags).length > 0 ? tags : undefined
}

export function resolveVercelSandboxConfig(
  config: SandboxConfig,
  opts?: { sandboxId?: string; env?: Record<string, unknown> },
): ResolvedVercelSandboxConfig {
  const env = opts?.env ?? process.env
  const profile = inferProfile(config, env)
  const isCodingAgent = profile === "coding-agent"

  const timeoutFromConfig = parseOptionalNumber(config.timeoutMs)
  const timeoutFromEnv = parseOptionalNumber(env.SANDBOX_VERCEL_TIMEOUT_MS)
  const timeoutDefault = isCodingAgent ? DEFAULT_CODING_AGENT_TIMEOUT_MS : DEFAULT_EPHEMERAL_TIMEOUT_MS
  const timeoutMs = clampInteger(timeoutFromConfig ?? timeoutFromEnv ?? timeoutDefault, 1_000, MAX_VERCEL_TIMEOUT_MS)

  const vcpusFromConfig = parseOptionalNumber(config.resources?.vcpus)
  const vcpusFromEnv = parseOptionalNumber(env.SANDBOX_VERCEL_VCPUS)
  const vcpusDefault = isCodingAgent ? 2 : 1
  const vcpus = clampInteger(vcpusFromConfig ?? vcpusFromEnv ?? vcpusDefault, 1, MAX_VERCEL_VCPUS)

  const name = String(config.vercel?.name ?? env.SANDBOX_VERCEL_NAME ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || undefined

  const persistent =
    config.vercel?.persistent ??
    parseOptionalBoolean(env.SANDBOX_VERCEL_PERSISTENT) ??
    isCodingAgent

  const reuse =
    config.vercel?.reuse ??
    parseOptionalBoolean(env.SANDBOX_VERCEL_REUSE) ??
    Boolean(persistent && name)

  const deleteOnStop =
    config.vercel?.deleteOnStop ??
    parseOptionalBoolean(env.SANDBOX_VERCEL_DELETE_ON_STOP) ??
    !persistent

  const snapshotExpirationFromConfig = parseOptionalNumber(config.vercel?.snapshotExpirationMs)
  const snapshotExpirationFromEnv = parseOptionalNumber(env.SANDBOX_VERCEL_SNAPSHOT_EXPIRATION_MS)
  const snapshotExpirationMs =
    snapshotExpirationFromConfig ??
    snapshotExpirationFromEnv ??
    (persistent ? DEFAULT_SNAPSHOT_EXPIRATION_MS : undefined)

  const base: Omit<ResolvedVercelSandboxConfig, "tags"> = {
    profile,
    runtime: String(config.runtime ?? "node22"),
    timeoutMs,
    ports: normalizePorts(config.ports),
    vcpus,
    ...(name ? { name } : {}),
    reuse,
    persistent,
    deleteOnStop,
    ...(snapshotExpirationMs !== undefined
      ? { snapshotExpirationMs: Math.max(0, Math.floor(snapshotExpirationMs)) }
      : {}),
  }

  return {
    ...base,
    tags: resolveTags(config, base, opts?.sandboxId),
  }
}

export function safeVercelConfigForRecord(
  config: SandboxConfig,
  resolved: ResolvedVercelSandboxConfig,
): Record<string, unknown> {
  const { token: _token, ...safeConfig } = config.vercel ?? {}

  return {
    ...safeConfig,
    profile: resolved.profile,
    runtime: resolved.runtime,
    timeoutMs: resolved.timeoutMs,
    vcpus: resolved.vcpus,
    ports: resolved.ports,
    persistent: resolved.persistent,
    deleteOnStop: resolved.deleteOnStop,
    reuse: resolved.reuse,
    ...(resolved.name ? { name: resolved.name } : {}),
    ...(resolved.snapshotExpirationMs !== undefined
      ? { snapshotExpirationMs: resolved.snapshotExpirationMs }
      : {}),
    ...(resolved.tags ? { tags: resolved.tags } : {}),
  }
}
