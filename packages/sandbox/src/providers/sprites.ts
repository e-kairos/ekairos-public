import type { SandboxConfig } from "../types.js"
import type { SpritesSandbox } from "./types.js"

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return ""
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
}

function sanitizeSpritesString(value: string): string {
  return value.includes("\0") ? value.replace(/\0/g, "") : value
}

function getSpritesConfig(): { baseUrl: string; token: string } {
  const token = String(process.env.SPRITES_API_TOKEN ?? process.env.SPRITE_TOKEN ?? "").trim()
  if (!token) {
    throw new Error("Missing required Sprites token env var: SPRITES_API_TOKEN (or SPRITE_TOKEN)")
  }

  const baseUrl =
    normalizeBaseUrl(
      String(process.env.SPRITES_API_BASE_URL ?? process.env.SPRITES_API_URL ?? "").trim(),
    ) || "https://api.sprites.dev"

  return { baseUrl, token }
}

export async function spritesFetch(path: string, init?: any): Promise<any> {
  const { baseUrl, token } = getSpritesConfig()
  const fetchFn = (globalThis as any)?.fetch
  if (typeof fetchFn !== "function") {
    throw new Error("fetch_not_available")
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = `${baseUrl}${normalizedPath}`

  return await fetchFn(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

export async function spritesJson<T = any>(path: string, init?: any): Promise<T> {
  const res = await spritesFetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res?.ok) {
    const text = await res?.text?.().catch(() => "")
    throw new Error(`sprites_http_${res?.status ?? "unknown"}: ${text || "request_failed"}`)
  }

  return (await res.json().catch(() => ({}))) as T
}

export async function spritesText(
  path: string,
  init?: any,
): Promise<{ status: number; ok: boolean; text: string }> {
  const res = await spritesFetch(path, init)
  const text = await res?.text?.().catch(() => "")
  return { ok: Boolean(res?.ok), status: Number(res?.status ?? 0), text: String(text ?? "") }
}

export function toSpritesPreviewUrl(spriteUrl: string, port: number): string {
  const base = String(spriteUrl ?? "").trim()
  if (!base) return ""
  try {
    const u = new URL(base)
    if (Number.isFinite(port) && port > 0) {
      u.port = String(Math.floor(port))
    }
    const next = u.toString()
    return next.endsWith("/") ? next.slice(0, -1) : next
  } catch {
    if (!port) return base
    return base.replace(/\/+$/, "") + ":" + String(Math.floor(port))
  }
}

export function asSpritesSandbox(sprite: {
  name: string
  id?: string
  url?: string
}): SpritesSandbox {
  const name = String(sprite?.name ?? "").trim()
  const url = typeof sprite?.url === "string" ? sprite.url : undefined
  return {
    __provider: "sprites",
    name,
    id: sprite?.id ? String(sprite.id) : undefined,
    url,
    getPreviewLink: async (port: number) => {
      const base = url ?? ""
      const next = toSpritesPreviewUrl(base, port)
      return { url: next }
    },
    domain: async (port: number) => {
      const base = url ?? ""
      return toSpritesPreviewUrl(base, port)
    },
  }
}

export async function getSpritesByName(
  name: string,
): Promise<{ ok: true; sprite: any } | { ok: false; status: number; error: string }> {
  const safeName = String(name ?? "").trim()
  if (!safeName) return { ok: false, status: 400, error: "sprites_name_required" }

  const res = await spritesFetch(`/v1/sprites/${encodeURIComponent(safeName)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  if (!res?.ok) {
    const text = await res?.text?.().catch(() => "")
    return {
      ok: false,
      status: Number(res?.status ?? 0),
      error: text || `sprites_http_${res?.status ?? "unknown"}`,
    }
  }
  const json = await res.json().catch(() => ({}))
  return { ok: true, sprite: json }
}

export async function provisionSpritesSandbox(params: {
  sandboxId: string
  config: SandboxConfig
}): Promise<SpritesSandbox> {
  const requestedName = String(params.config?.sprites?.name ?? "").trim()
  const name = requestedName || `ekairos-${params.sandboxId}`

  const existing = await getSpritesByName(name)
  if (existing.ok) {
    const sprite = existing.sprite ?? {}
    return asSpritesSandbox({
      name: String(sprite?.name ?? name),
      id: sprite?.id ? String(sprite.id) : undefined,
      url: typeof sprite?.url === "string" ? sprite.url : undefined,
    })
  }

  const waitForCapacity = params.config?.sprites?.waitForCapacity ?? true
  const auth = params.config?.sprites?.urlSettings?.auth ?? "public"
  const body = {
    name,
    wait_for_capacity: Boolean(waitForCapacity),
    url_settings: { auth },
  }

  const created = await spritesJson<any>("/v1/sprites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  return asSpritesSandbox({
    name: String(created?.name ?? name),
    id: created?.id ? String(created.id) : undefined,
    url: typeof created?.url === "string" ? created.url : undefined,
  })
}

function normalizeSpritesExecResult(payload: any): {
  exitCode: number
  stdout: string
  stderr: string
} {
  const exitCodeRaw =
    payload?.exit_code ??
    payload?.exitCode ??
    payload?.code ??
    payload?.status ??
    payload?.result?.exit_code ??
    payload?.result?.exitCode

  const exitCode = Number(exitCodeRaw ?? 0)
  const stdout =
    typeof payload?.stdout === "string"
      ? payload.stdout
      : typeof payload?.output === "string"
        ? payload.output
        : typeof payload?.out === "string"
          ? payload.out
          : typeof payload?.result?.stdout === "string"
            ? payload.result.stdout
            : ""

  const stderr =
    typeof payload?.stderr === "string"
      ? payload.stderr
      : typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.err === "string"
          ? payload.err
          : typeof payload?.result?.stderr === "string"
            ? payload.result.stderr
            : ""

  return {
    exitCode: Number.isFinite(exitCode) ? exitCode : 0,
    stdout: sanitizeSpritesString(stdout),
    stderr: sanitizeSpritesString(stderr),
  }
}

export async function spritesExec(params: {
  spriteName: string
  command: string
  args?: string[]
  stdin?: string | Buffer
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const spriteName = String(params.spriteName ?? "").trim()
  if (!spriteName) throw new Error("sprites_name_required")

  const parts = [String(params.command ?? "").trim(), ...(Array.isArray(params.args) ? params.args : [])].filter(Boolean)
  if (parts.length === 0) throw new Error("sprites_command_required")

  const search = new URLSearchParams()
  for (const part of parts) {
    search.append("cmd", String(part))
  }

  const hasStdin = typeof params.stdin === "string" || Buffer.isBuffer(params.stdin)
  if (hasStdin) {
    search.set("stdin", "true")
  }

  const path = `/v1/sprites/${encodeURIComponent(spriteName)}/exec?${search.toString()}`
  const init: any = {
    method: "POST",
  }
  if (hasStdin) {
    init.body = params.stdin
  }

  const res = await spritesFetch(path, init)
  const text = await res?.text?.().catch(() => "")
  const parsed = (() => {
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return { stdout: String(text ?? "") }
    }
  })()

  if (!res?.ok) {
    const err = typeof parsed?.error === "string" ? parsed.error : text
    throw new Error(err || `sprites_exec_http_${res?.status ?? "unknown"}`)
  }

  return normalizeSpritesExecResult(parsed)
}

export function parseSpritesCheckpointIdFromNdjson(text: string): string | null {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  const candidates: string[] = []

  for (const line of lines) {
    try {
      const evt = JSON.parse(line)
      const data = typeof evt?.data === "string" ? evt.data : ""
      if (!data) continue
      const m = data.match(/\bID:\s*(v[0-9]+)\b/i) || data.match(/\bCheckpoint\s+(v[0-9]+)\b/i)
      if (m?.[1]) {
        candidates.push(String(m[1]))
      }
    } catch {
      // ignore invalid ndjson lines
    }
  }

  if (candidates.length === 0) return null
  return candidates[candidates.length - 1] ?? null
}
