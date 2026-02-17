import { Sandbox as VercelSandbox } from "@vercel/sandbox"
import { Daytona, Image, type DaytonaConfig, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { id, type InstantAdminDatabase } from "@instantdb/admin"
import { SchemaOf } from "@ekairos/domain"
import { runCommandInSandbox, type CommandResult } from "./commands.js"
import { sandboxDomain } from "./schema.js"
import type { SandboxConfig, SandboxProvider } from "./types.js"

type SandboxSchemaType = SchemaOf<typeof sandboxDomain>

export interface SandboxRecord {
  id: string
  externalSandboxId?: string
  provider: string
  sandboxUrl?: string
  status: "creating" | "active" | "shutdown" | "error" | "recreating"
  timeout?: number
  runtime?: string
  vcpus?: number
  ports?: number[]
  purpose?: string
  params?: Record<string, any>
  createdAt: number
  updatedAt?: number
  shutdownAt?: number
}

export type ServiceResult<T = any> = { ok: true; data: T } | { ok: false; error: string }

type SpritesSandbox = {
  __provider: "sprites"
  name: string
  id?: string
  url?: string
  getPreviewLink?: (port: number) => Promise<{ url: string }>
  domain?: (port: number) => Promise<string>
}

type ProviderSandbox = VercelSandbox | DaytonaSandbox | SpritesSandbox

function formatInstantSchemaError(err: any): string {
  const base = err instanceof Error ? err.message : String(err)
  const body = err?.body
  const hintErrors = body?.hint?.errors

  if (!Array.isArray(hintErrors) || hintErrors.length === 0) {
    return base
  }

  const missingAttrs: string[] = []
  for (const he of hintErrors) {
    const attrs = he?.hint?.attributes
    if (Array.isArray(attrs)) {
      for (const a of attrs) {
        if (typeof a === "string") missingAttrs.push(a)
      }
    }
  }

  const uniq = Array.from(new Set(missingAttrs))
  if (uniq.length === 0) return base

  // Keep it short + copy/paste friendly for debugging schema issues.
  return base + " | missing attributes: " + uniq.join(", ")
}

export class SandboxService {
  private adminDb: InstantAdminDatabase<SandboxSchemaType>

  constructor(db: InstantAdminDatabase<SandboxSchemaType>) {
    this.adminDb = db
  }

  private static getVercelCredentials() {
    const teamId = String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim()
    const projectId = String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim()
    const token = String(process.env.SANDBOX_VERCEL_TOKEN ?? "").trim()

    if (!teamId || !projectId || !token) {
      throw new Error("Missing required Vercel sandbox environment variables")
    }

    return { teamId, projectId, token }
  }

  private static async provisionVercelSandbox(config: SandboxConfig): Promise<VercelSandbox> {
    const creds = SandboxService.getVercelCredentials()

    return await VercelSandbox.create({
      teamId: creds.teamId,
      projectId: creds.projectId,
      token: creds.token,
      timeout: config.timeoutMs ?? 30 * 60 * 1000,
      ports: Array.isArray(config.ports) ? config.ports : [],
      // IMPORTANT: pass runtime as-is (e.g. "python3.13") to match provider expectations.
      // Don't normalize to "python3"/"node22" as that can cause provider-side 400s.
      runtime: (config.runtime ?? "node22") as any,
      resources: { vcpus: config.resources?.vcpus ?? 2 },
    } as any)
  }

  private static getDaytonaConfig(): DaytonaConfig {
    const apiKey = String(process.env.DAYTONA_API_KEY ?? "").trim()
    const apiUrl =
      String(process.env.DAYTONA_API_URL ?? "").trim() ||
      String(process.env.DAYTONA_SERVER_URL ?? "").trim()
    const jwtToken = String(process.env.DAYTONA_JWT_TOKEN ?? "").trim()
    const organizationId = String(process.env.DAYTONA_ORGANIZATION_ID ?? "").trim()
    const target = String(process.env.DAYTONA_TARGET ?? "").trim()

    if (!apiUrl) {
      throw new Error("Missing required Daytona env var: DAYTONA_API_URL (or DAYTONA_SERVER_URL)")
    }
    if (!apiKey && !(jwtToken && organizationId)) {
      throw new Error("Missing required Daytona env vars: DAYTONA_API_KEY or DAYTONA_JWT_TOKEN + DAYTONA_ORGANIZATION_ID")
    }

    const config: DaytonaConfig = {
      apiUrl,
      target: target || undefined,
      apiKey: apiKey || undefined,
      jwtToken: jwtToken || undefined,
      organizationId: organizationId || undefined,
    }

    return config
  }

  private static normalizeBaseUrl(raw: string): string {
    const trimmed = String(raw ?? "").trim()
    if (!trimmed) return ""
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
  }

  private static getSpritesConfig(): { baseUrl: string; token: string } {
    const token = String(process.env.SPRITES_API_TOKEN ?? process.env.SPRITE_TOKEN ?? "").trim()
    if (!token) {
      throw new Error("Missing required Sprites token env var: SPRITES_API_TOKEN (or SPRITE_TOKEN)")
    }

    const baseUrl =
      SandboxService.normalizeBaseUrl(
        String(process.env.SPRITES_API_BASE_URL ?? process.env.SPRITES_API_URL ?? "").trim(),
      ) || "https://api.sprites.dev"

    return { baseUrl, token }
  }

  private static async spritesFetch(path: string, init?: any): Promise<any> {
    const { baseUrl, token } = SandboxService.getSpritesConfig()
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

  private static async spritesJson<T = any>(path: string, init?: any): Promise<T> {
    const res = await SandboxService.spritesFetch(path, {
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

  private static async spritesText(path: string, init?: any): Promise<{ status: number; ok: boolean; text: string }> {
    const res = await SandboxService.spritesFetch(path, init)
    const text = await res?.text?.().catch(() => "")
    return { ok: Boolean(res?.ok), status: Number(res?.status ?? 0), text: String(text ?? "") }
  }

  private static toSpritesPreviewUrl(spriteUrl: string, port: number): string {
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
      // Best effort fallback: append port if missing.
      if (!port) return base
      return base.replace(/\/+$/, "") + ":" + String(Math.floor(port))
    }
  }

  private static asSpritesSandbox(sprite: { name: string; id?: string; url?: string }): SpritesSandbox {
    const name = String(sprite?.name ?? "").trim()
    const url = typeof sprite?.url === "string" ? sprite.url : undefined
    return {
      __provider: "sprites",
      name,
      id: sprite?.id ? String(sprite.id) : undefined,
      url,
      getPreviewLink: async (port: number) => {
        const base = url ?? ""
        const next = SandboxService.toSpritesPreviewUrl(base, port)
        return { url: next }
      },
      domain: async (port: number) => {
        const base = url ?? ""
        return SandboxService.toSpritesPreviewUrl(base, port)
      },
    }
  }

  private static async getSpritesByName(name: string): Promise<{ ok: true; sprite: any } | { ok: false; status: number; error: string }> {
    const safeName = String(name ?? "").trim()
    if (!safeName) return { ok: false, status: 400, error: "sprites_name_required" }

    const res = await SandboxService.spritesFetch(`/v1/sprites/${encodeURIComponent(safeName)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (!res?.ok) {
      const text = await res?.text?.().catch(() => "")
      return { ok: false, status: Number(res?.status ?? 0), error: text || `sprites_http_${res?.status ?? "unknown"}` }
    }
    const json = await res.json().catch(() => ({}))
    return { ok: true, sprite: json }
  }

  private static async provisionSpritesSandbox(params: { sandboxId: string; config: SandboxConfig }): Promise<SpritesSandbox> {
    const requestedName = String(params.config?.sprites?.name ?? "").trim()
    const name = requestedName || `ekairos-${params.sandboxId}`

    // Idempotent: if already exists, reuse.
    const existing = await SandboxService.getSpritesByName(name)
    if (existing.ok) {
      const sprite = existing.sprite ?? {}
      return SandboxService.asSpritesSandbox({
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

    const created = await SandboxService.spritesJson<any>("/v1/sprites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    return SandboxService.asSpritesSandbox({
      name: String(created?.name ?? name),
      id: created?.id ? String(created.id) : undefined,
      url: typeof created?.url === "string" ? created.url : undefined,
    })
  }

  private static normalizeSpritesExecResult(payload: any): { exitCode: number; stdout: string; stderr: string } {
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
      stdout,
      stderr,
    }
  }

  private static async spritesExec(params: {
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

    const res = await SandboxService.spritesFetch(path, init)
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

    return SandboxService.normalizeSpritesExecResult(parsed)
  }

  private static resolveProvider(config: SandboxConfig): SandboxProvider {
    const explicit = String(config.provider ?? "").trim().toLowerCase()
    if (explicit === "daytona") return "daytona"
    if (explicit === "vercel") return "vercel"
    if (explicit === "sprites") return "sprites"

    const env = String(process.env.SANDBOX_PROVIDER ?? "").trim().toLowerCase()
    if (env === "daytona") return "daytona"
    if (env === "vercel") return "vercel"
    if (env === "sprites") return "sprites"

    return "sprites"
  }

  private static resolveDaytonaLanguage(config: SandboxConfig): "python" | "typescript" | "javascript" | undefined {
    if (config.daytona?.language) return config.daytona.language
    const runtime = String(config.runtime ?? "").toLowerCase()
    if (runtime.startsWith("python")) return "python"
    if (runtime.startsWith("node")) return "javascript"
    if (runtime.startsWith("ts") || runtime.includes("typescript")) return "typescript"
    return undefined
  }

  private static async resolveDaytonaVolumes(
    daytona: Daytona,
    volumes: Array<{ volumeId?: string; volumeName?: string; mountPath: string }>,
  ): Promise<Array<{ volumeId: string; mountPath: string }>> {
    if (!volumes || volumes.length === 0) return []

    const resolved: Array<{ volumeId: string; mountPath: string }> = []
    const shouldLog = SandboxService.parseOptionalBoolean(process.env.SANDBOX_DAYTONA_LOG_VOLUMES) ?? false
    for (const volume of volumes) {
      const mountPath = String(volume.mountPath ?? "").trim()
      if (!mountPath) continue

      const volumeId = String(volume.volumeId ?? "").trim()
      if (volumeId) {
        resolved.push({ volumeId, mountPath })
        continue
      }

      const volumeName = String(volume.volumeName ?? "").trim()
      if (!volumeName) {
        throw new Error("Daytona volume requires volumeId or volumeName")
      }

      let resolvedVolume = await daytona.volume.get(volumeName, true)
      const stateRaw = String((resolvedVolume as any)?.state ?? "").trim().toLowerCase()
      const waitStates = new Set(["creating", "provisioning", "pending", "pending_create", "pending-create", "initializing"])
      const readyStates = new Set(["available", "active", "ready"])

      if (waitStates.has(stateRaw)) {
        const maxAttempts = 12
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, 1000 * attempt))
          resolvedVolume = await daytona.volume.get(volumeName, true)
          const state = String((resolvedVolume as any)?.state ?? "").trim().toLowerCase()
          if (shouldLog) {
            console.log(`[daytona:volume] name=${volumeName} state=${state} attempt=${attempt}/${maxAttempts}`)
          }
          if (readyStates.has(state)) break
        }
      }

      const finalState = String((resolvedVolume as any)?.state ?? "").trim().toLowerCase()
      if (finalState && !readyStates.has(finalState)) {
        if (shouldLog) {
          console.log(
            `[daytona:volume] name=${volumeName} state=${finalState} mountPath=${mountPath} (not ready)`,
          )
        }
        throw new Error(`Daytona volume not ready: ${volumeName} (state=${finalState})`)
      }

      const resolvedId = String((resolvedVolume as any)?.id ?? "").trim()
      if (!resolvedId) {
        throw new Error(`Daytona volume not resolved: ${volumeName}`)
      }
      if (shouldLog) {
        console.log(`[daytona:volume] name=${volumeName} id=${resolvedId} mountPath=${mountPath}`)
      }
      resolved.push({ volumeId: resolvedId, mountPath })
    }

    return resolved
  }

  private static shellEscapeArg(value: string): string {
    if (value.length === 0) return "''"
    if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
  }

  private static parseOptionalBoolean(value?: string): boolean | undefined {
    const normalized = String(value ?? "").trim().toLowerCase()
    if (!normalized) return undefined
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
    return undefined
  }

  private static parseCsvList(value?: string): string[] {
    return String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  private static resolvePythonVersion(runtime?: string): string {
    const fromEnv =
      String(process.env.SANDBOX_DAYTONA_DECLARATIVE_PYTHON ?? "").trim() ||
      String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_PYTHON ?? "").trim()
    if (fromEnv) return fromEnv
    const match = String(runtime ?? "").match(/python\s*([0-9]+\.[0-9]+)/i)
    if (match?.[1]) return match[1]
    return "3.12"
  }

  private static buildDeclarativeImage(config: SandboxConfig): Image | undefined {
    const imageFlag = String(config.daytona?.image ?? "").trim()
    const envFlag =
      SandboxService.parseOptionalBoolean(process.env.SANDBOX_DAYTONA_DECLARATIVE_IMAGE) ??
      SandboxService.parseOptionalBoolean(process.env.STRUCTURE_DAYTONA_DECLARATIVE_IMAGE) ??
      false
    const useDeclarative = envFlag || imageFlag.startsWith("declarative")
    if (!useDeclarative) return undefined

    const baseImage =
      String(process.env.SANDBOX_DAYTONA_DECLARATIVE_BASE ?? "").trim() ||
      String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_BASE ?? "").trim()
    const pythonVersion = SandboxService.resolvePythonVersion(config.runtime)
    const isStructureDataset =
      config.purpose === "structure.dataset" || typeof (config.params as any)?.datasetId === "string"
    const defaultPackages = isStructureDataset ? ["pandas", "openpyxl"] : []
    const packages = [
      ...SandboxService.parseCsvList(process.env.SANDBOX_DAYTONA_DECLARATIVE_PIP),
      ...SandboxService.parseCsvList(process.env.STRUCTURE_DAYTONA_DECLARATIVE_PIP),
      ...defaultPackages,
    ]
    const uniquePackages = Array.from(new Set(packages))

    let image: Image
    if (baseImage) {
      image = Image.base(baseImage)
    } else {
      image = Image.debianSlim(pythonVersion as any)
    }
    if (uniquePackages.length > 0) {
      image = image.pipInstall(uniquePackages)
    }
    image = image.workdir("/home/daytona")
    return image
  }

  async createSandbox(config: SandboxConfig): Promise<ServiceResult<{ sandboxId: string }>> {
    const sandboxId = id()
    const now = Date.now()
    const provider = SandboxService.resolveProvider(config)
    let daytonaEphemeral: boolean | undefined = undefined

    try {
      const baseParams =
        config.params && typeof config.params === "object" && !Array.isArray(config.params) ? config.params : {}

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          status: "creating",
          provider,
          timeout: config.timeoutMs,
          runtime: config.runtime,
          vcpus: config.resources?.vcpus,
          ports: config.ports as any,
          purpose: config.purpose,
          params: baseParams,
          createdAt: now,
          updatedAt: now,
        }),
      )

      let sandbox: ProviderSandbox
      try {
        if (provider === "daytona") {
          const daytona = new Daytona(SandboxService.getDaytonaConfig())
          const language = SandboxService.resolveDaytonaLanguage(config)
          const requestedVolumes = config.daytona?.volumes ?? []
          const volumes = await SandboxService.resolveDaytonaVolumes(daytona, requestedVolumes)
          const envVars = config.daytona?.envVars
          const isPublic = config.daytona?.public
          const envEphemeral = SandboxService.parseOptionalBoolean(process.env.SANDBOX_DAYTONA_EPHEMERAL)
          const ephemeral = config.daytona?.ephemeral ?? envEphemeral ?? true
          daytonaEphemeral = ephemeral
          const user = config.daytona?.user
          const autoStopInterval = config.daytona?.autoStopIntervalMin
          const autoArchiveInterval = config.daytona?.autoArchiveIntervalMin
          const autoDeleteInterval = config.daytona?.autoDeleteIntervalMin
          const resolvedAutoDeleteInterval = ephemeral ? undefined : autoDeleteInterval
          const declarativeImage = SandboxService.buildDeclarativeImage(config)
          const image = declarativeImage ?? config.daytona?.image
          const snapshot = config.daytona?.snapshot
          const resources = config.resources?.vcpus ? { cpu: config.resources.vcpus } : undefined
          const labels = {
            ...(config.daytona?.labels ?? {}),
            ekairos: "1",
            ekairos_ephemeral: ephemeral ? "1" : "0",
            ...(baseParams as any)?.datasetId ? { ekairos_dataset_id: String((baseParams as any).datasetId) } : {},
          }
          const baseCreateParams = {
            language,
            envVars,
            labels,
            public: isPublic,
            ephemeral,
            user,
            volumes: volumes.length > 0 ? volumes : undefined,
            autoStopInterval,
            autoArchiveInterval,
          } as any
          if (resolvedAutoDeleteInterval !== undefined) {
            baseCreateParams.autoDeleteInterval = resolvedAutoDeleteInterval
          }

          if (image) {
            sandbox = await daytona.create({
              image,
              resources,
              ...baseCreateParams,
            })
          } else {
            sandbox = await daytona.create({
              snapshot,
              ...baseCreateParams,
            })
          }
        } else if (provider === "sprites") {
          sandbox = await SandboxService.provisionSpritesSandbox({
            sandboxId,
            config,
          })
        } else {
          sandbox = await SandboxService.provisionVercelSandbox(config)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await this.adminDb.transact(
          this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
            status: "error",
            updatedAt: Date.now(),
            params: { ...(config.params ?? {}), error: msg },
          }),
        )
        return { ok: false, error: msg }
      }

      const externalSandboxId =
        provider === "daytona"
          ? (sandbox as DaytonaSandbox).id
          : provider === "sprites"
            ? String((sandbox as SpritesSandbox).name)
            : (sandbox as VercelSandbox).sandboxId

      const sandboxUrl = provider === "sprites" ? (sandbox as SpritesSandbox).url : undefined

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          status: "active",
          externalSandboxId,
          ...(sandboxUrl ? { sandboxUrl } : {}),
          updatedAt: Date.now(),
          params: {
            ...baseParams,
            ...(provider === "daytona"
              ? {
                  daytona: {
                    ...(baseParams as any)?.daytona,
                    ephemeral: daytonaEphemeral,
                  },
                }
              : {}),
            ...(provider === "sprites"
              ? {
                  sprites: {
                    ...(baseParams as any)?.sprites,
                    id: (sandbox as SpritesSandbox).id,
                    name: (sandbox as SpritesSandbox).name,
                    url: (sandbox as SpritesSandbox).url,
                    urlSettings: config.sprites?.urlSettings ?? (baseParams as any)?.sprites?.urlSettings ?? undefined,
                    deleteOnStop:
                      config.sprites?.deleteOnStop ?? (baseParams as any)?.sprites?.deleteOnStop ?? true,
                  },
                }
              : {}),
          },
        }),
      )

      return { ok: true, data: { sandboxId } }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async reconnectToSandbox(sandboxId: string): Promise<ServiceResult<{ sandbox: ProviderSandbox }>> {
    try {
      const recordResult: any = await this.adminDb.query({
        sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
      })
      const record = recordResult?.sandbox_sandboxes?.[0]

      if (!record || !record.externalSandboxId) {
        return { ok: false, error: "Valid sandbox record not found" }
      }

      if (record.provider === "daytona") {
        const daytona = new Daytona(SandboxService.getDaytonaConfig())
        try {
          const sandbox = await daytona.get(String(record.externalSandboxId))
          const state = String((sandbox as any).state ?? "").toLowerCase()
          if (state && state !== "running") {
            await daytona.start(sandbox, 60)
          }
          return { ok: true, data: { sandbox } }
        } catch (e) {
          if (record.status === "active") {
            await this.adminDb.transact(
              this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
                status: "shutdown",
                shutdownAt: Date.now(),
                updatedAt: Date.now(),
              }),
            )
          }
          const msg = e instanceof Error ? e.message : String(e)
          return { ok: false, error: msg }
        }
      }

      if (record.provider === "sprites") {
        const name = String(record.externalSandboxId ?? "").trim()
        try {
          const spriteRes = await SandboxService.getSpritesByName(name)
          if (!spriteRes.ok) {
            if (record.status === "active") {
              await this.adminDb.transact(
                this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
                  status: "shutdown",
                  shutdownAt: Date.now(),
                  updatedAt: Date.now(),
                }),
              )
            }
            return { ok: false, error: spriteRes.error || "sprites_not_found" }
          }

          const sprite = spriteRes.sprite ?? {}
          const spritesSandbox = SandboxService.asSpritesSandbox({
            name: String(sprite?.name ?? name),
            id: sprite?.id ? String(sprite.id) : undefined,
            url: typeof sprite?.url === "string" ? sprite.url : undefined,
          })

          // Best-effort: keep URL metadata fresh for consumers that rely on record.sandboxUrl.
          const nextUrl = spritesSandbox.url
          if (nextUrl && nextUrl !== record.sandboxUrl) {
            try {
              await this.adminDb.transact(
                this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
                  sandboxUrl: nextUrl,
                  updatedAt: Date.now(),
                  params: {
                    ...(record.params ?? {}),
                    sprites: {
                      ...(record.params?.sprites ?? {}),
                      id: spritesSandbox.id,
                      name: spritesSandbox.name,
                      url: nextUrl,
                    },
                  },
                }),
              )
            } catch {
              // ignore metadata update errors
            }
          }

          return { ok: true, data: { sandbox: spritesSandbox } }
        } catch (e) {
          if (record.status === "active") {
            await this.adminDb.transact(
              this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
                status: "shutdown",
                shutdownAt: Date.now(),
                updatedAt: Date.now(),
              }),
            )
          }
          const msg = e instanceof Error ? e.message : String(e)
          return { ok: false, error: msg }
        }
      }

      if (record.provider !== "vercel") {
        return { ok: false, error: "Valid sandbox record not found" }
      }

      const creds = SandboxService.getVercelCredentials()

      try {
        const maxAttempts = 20
        const delayMs = 500

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const sandbox = await VercelSandbox.get({
            sandboxId: String(record.externalSandboxId),
            teamId: creds.teamId,
            projectId: creds.projectId,
            token: creds.token,
          } as any)

          if (!sandbox) return { ok: false, error: "Sandbox not found" }
          if (sandbox.status === "running") {
            return { ok: true, data: { sandbox } }
          }

          await new Promise((r) => setTimeout(r, delayMs))
        }

        return { ok: false, error: "Sandbox not active" }
      } catch (e) {
        if (record.status === "active") {
          await this.adminDb.transact(
            this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
              status: "shutdown",
              shutdownAt: Date.now(),
              updatedAt: Date.now(),
            }),
          )
        }
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: msg }
      }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async stopSandbox(sandboxId: string): Promise<ServiceResult<void>> {
    try {
      const result = await this.reconnectToSandbox(sandboxId)
      const recordResult: any = await this.adminDb.query({
        sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
      })
      const record = recordResult?.sandbox_sandboxes?.[0]
      const deleteOnStop =
        record?.provider === "sprites"
          ? SandboxService.parseOptionalBoolean(process.env.SANDBOX_SPRITES_DELETE_ON_STOP) ??
            Boolean(record?.params?.sprites?.deleteOnStop ?? true)
          : SandboxService.parseOptionalBoolean(process.env.SANDBOX_DAYTONA_DELETE_ON_STOP) ??
            Boolean(record?.params?.daytona?.ephemeral)
      if (result.ok) {
        try {
          const sandbox: any = result.data.sandbox as any
          if (sandbox?.sandboxId) {
            await (sandbox as VercelSandbox).stop()
          } else if (sandbox?.__provider === "sprites") {
            // Sprites does not have a reliable "stop" semantic; deleting is the durable cleanup primitive.
            try {
              await SandboxService.spritesFetch(`/v1/sprites/${encodeURIComponent(String(sandbox.name))}`, {
                method: "DELETE",
              })
            } catch {
              // ignore delete errors
            }
          } else {
            const daytona = new Daytona(SandboxService.getDaytonaConfig())
            await daytona.stop(sandbox as DaytonaSandbox)
            if (deleteOnStop) {
              try {
                await daytona.delete(sandbox as DaytonaSandbox, 60)
              } catch {
                // ignore delete errors
              }
            }
          }
        } catch {
          // ignore
        }
      }

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          status: "shutdown",
          shutdownAt: Date.now(),
          updatedAt: Date.now(),
        }),
      )

      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async runCommand(sandboxId: string, command: string, args: string[] = []): Promise<ServiceResult<CommandResult>> {
    try {
      const sandboxResult = await this.reconnectToSandbox(sandboxId)
      if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }

      const sandbox = sandboxResult.data.sandbox
      if ((sandbox as any).sandboxId) {
        const result = await runCommandInSandbox(sandbox as VercelSandbox, command, args)
        return { ok: true, data: result }
      }

      if ((sandbox as any).__provider === "sprites") {
        const fullCommand = args.length > 0 ? [command, ...args].join(" ") : command
        const res = await SandboxService.spritesExec({
          spriteName: String((sandbox as any).name ?? ""),
          command,
          args,
        })
        return {
          ok: true,
          data: {
            success: res.exitCode === 0,
            exitCode: res.exitCode,
            output: res.stdout,
            error: res.stderr,
            command: fullCommand,
          },
        }
      }

      const commandStr =
        args.length > 0
          ? [command, ...args.map((arg) => SandboxService.shellEscapeArg(String(arg)))].join(" ")
          : command
      const res = await (sandbox as DaytonaSandbox).process.executeCommand(commandStr)
      return {
        ok: true,
        data: {
          success: (res.exitCode ?? 0) === 0,
          exitCode: res.exitCode ?? 0,
          output: res.artifacts?.stdout ?? res.result ?? "",
          error: "",
          command: commandStr,
        },
      }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async writeFiles(
    sandboxId: string,
    files: Array<{ path: string; contentBase64: string }>,
  ): Promise<ServiceResult<void>> {
    try {
      const sandboxResult = await this.reconnectToSandbox(sandboxId)
      if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }

      const sandbox = sandboxResult.data.sandbox
      if ((sandbox as any).sandboxId) {
        await (sandbox as VercelSandbox).writeFiles(
          files.map((f) => ({
            path: f.path,
            content: Buffer.from(f.contentBase64, "base64"),
          })),
        )
      } else if ((sandbox as any).__provider === "sprites") {
        const spriteName = String((sandbox as any).name ?? "").trim()
        if (!spriteName) return { ok: false, error: "sprites_name_required" }

        for (const f of files) {
          const filePath = String(f.path ?? "").trim()
          if (!filePath) continue
          const dirPath = filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : ""
          const dirCmd = dirPath ? `mkdir -p ${SandboxService.shellEscapeArg(dirPath)} && ` : ""
          const cmd = `${dirCmd}printf %s ${SandboxService.shellEscapeArg(String(f.contentBase64 ?? ""))} | base64 -d > ${SandboxService.shellEscapeArg(filePath)}`

          await SandboxService.spritesExec({
            spriteName,
            command: "sh",
            args: ["-lc", cmd],
          })
        }
      } else {
        await (sandbox as DaytonaSandbox).fs.uploadFiles(
          files.map((f) => ({
            source: Buffer.from(f.contentBase64, "base64"),
            destination: f.path,
          })),
        )
      }

      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async readFile(sandboxId: string, path: string): Promise<ServiceResult<{ contentBase64: string }>> {
    try {
      const sandboxResult = await this.reconnectToSandbox(sandboxId)
      if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }

      const sandbox = sandboxResult.data.sandbox
      if ((sandbox as any).sandboxId) {
        const stream = await (sandbox as VercelSandbox).readFile({ path })
        if (!stream) {
          return { ok: true, data: { contentBase64: "" } }
        }

        const chunks: Buffer[] = []
        for await (const chunk of stream as AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>) {
          if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk, "utf-8"))
          } else if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk))
          } else if (chunk instanceof ArrayBuffer) {
            chunks.push(Buffer.from(chunk))
          } else if (chunk) {
            chunks.push(Buffer.from(chunk))
          }
        }

        return { ok: true, data: { contentBase64: Buffer.concat(chunks).toString("base64") } }
      }

      if ((sandbox as any).__provider === "sprites") {
        const spriteName = String((sandbox as any).name ?? "").trim()
        if (!spriteName) return { ok: false, error: "sprites_name_required" }

        const filePath = String(path ?? "").trim()
        const cmd = `if [ -f ${SandboxService.shellEscapeArg(filePath)} ]; then base64 ${SandboxService.shellEscapeArg(
          filePath,
        )} | tr -d '\\n'; fi`

        const res = await SandboxService.spritesExec({
          spriteName,
          command: "sh",
          args: ["-lc", cmd],
        })

        return { ok: true, data: { contentBase64: String(res.stdout ?? "").trim() } }
      }

      const buf = await (sandbox as DaytonaSandbox).fs.downloadFile(path)
      return { ok: true, data: { contentBase64: Buffer.from(buf).toString("base64") } }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  private static parseSpritesCheckpointIdFromNdjson(text: string): string | null {
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

  async createCheckpoint(
    sandboxId: string,
    params?: { comment?: string },
  ): Promise<ServiceResult<{ checkpointId: string }>> {
    try {
      const recordResult: any = await this.adminDb.query({
        sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
      })
      const record = recordResult?.sandbox_sandboxes?.[0]
      if (!record?.externalSandboxId || record.provider !== "sprites") {
        return { ok: false, error: "checkpoint_not_supported" }
      }

      const name = String(record.externalSandboxId).trim()
      const comment = String(params?.comment ?? "").trim()
      const body = comment ? { comment } : {}

      const res = await SandboxService.spritesFetch(`/v1/sprites/${encodeURIComponent(name)}/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const text = await res?.text?.().catch(() => "")
      if (!res?.ok) {
        return { ok: false, error: text || `sprites_checkpoint_http_${res?.status ?? "unknown"}` }
      }

      const checkpointId = SandboxService.parseSpritesCheckpointIdFromNdjson(text)
      if (!checkpointId) {
        return { ok: false, error: "sprites_checkpoint_id_missing" }
      }

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          updatedAt: Date.now(),
          params: {
            ...(record.params ?? {}),
            sprites: {
              ...(record.params?.sprites ?? {}),
              lastCheckpointId: checkpointId,
            },
          },
        }),
      )

      return { ok: true, data: { checkpointId } }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async listCheckpoints(sandboxId: string): Promise<ServiceResult<{ checkpointIds: string[] }>> {
    try {
      const recordResult: any = await this.adminDb.query({
        sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
      })
      const record = recordResult?.sandbox_sandboxes?.[0]
      if (!record?.externalSandboxId || record.provider !== "sprites") {
        return { ok: false, error: "checkpoint_not_supported" }
      }

      const name = String(record.externalSandboxId).trim()
      const json = await SandboxService.spritesJson<any>(`/v1/sprites/${encodeURIComponent(name)}/checkpoints`, {
        method: "GET",
        headers: { Accept: "application/json" },
      })

      const list = Array.isArray(json) ? json : Array.isArray(json?.checkpoints) ? json.checkpoints : []
      const checkpointIds = list
        .map((cp: any) => String(cp?.id ?? cp?.checkpoint_id ?? "").trim())
        .filter(Boolean)

      return { ok: true, data: { checkpointIds } }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async restoreCheckpoint(sandboxId: string, checkpointId: string): Promise<ServiceResult<void>> {
    try {
      const recordResult: any = await this.adminDb.query({
        sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
      })
      const record = recordResult?.sandbox_sandboxes?.[0]
      if (!record?.externalSandboxId || record.provider !== "sprites") {
        return { ok: false, error: "checkpoint_not_supported" }
      }

      const name = String(record.externalSandboxId).trim()
      const cp = String(checkpointId ?? "").trim()
      if (!cp) return { ok: false, error: "checkpoint_id_required" }

      const res = await SandboxService.spritesFetch(
        `/v1/sprites/${encodeURIComponent(name)}/checkpoints/${encodeURIComponent(cp)}/restore`,
        { method: "POST" },
      )

      const text = await res?.text?.().catch(() => "")
      if (!res?.ok) {
        return { ok: false, error: text || `sprites_restore_http_${res?.status ?? "unknown"}` }
      }

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          updatedAt: Date.now(),
          params: {
            ...(record.params ?? {}),
            sprites: {
              ...(record.params?.sprites ?? {}),
              lastRestoredCheckpointId: cp,
            },
          },
        }),
      )

      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }
}

