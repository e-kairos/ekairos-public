import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot, type NetworkPolicy } from "@vercel/sandbox"
import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { id, init, type InstantAdminDatabase } from "@instantdb/admin"
import type { InstaQLParams } from "@instantdb/core"
import type { DomainInstantSchema } from "@ekairos/domain"
import { resolveRuntime, type RuntimeDomainSource } from "@ekairos/domain/runtime"
import { runCommandInSandbox, type CommandResult } from "./commands.js"
import { sandboxSchemaDomain } from "./schema.js"
import type { SandboxConfig, SandboxInstallableSkill } from "./types.js"
import {
  buildDeclarativeImage,
  getDaytonaConfig,
  resolveDaytonaLanguage,
  resolveDaytonaVolumes,
} from "./providers/daytona.js"
import { resolveProvider } from "./providers/provider.js"
import {
  asSpritesSandbox,
  getSpritesByName,
  parseSpritesCheckpointIdFromNdjson,
  provisionSpritesSandbox,
  spritesExec,
  spritesFetch,
  spritesJson,
} from "./providers/sprites.js"
import {
  isVercelSandbox,
  type ProviderSandbox,
  type SpritesSandbox,
} from "./providers/types.js"
import {
  provisionVercelSandbox,
  resolveVercelCredentials,
} from "./providers/vercel.js"
import {
  resolveVercelSandboxConfig,
  safeVercelConfigForRecord,
} from "./vercel-options.js"
import { randomUUID } from "node:crypto"
import path from "node:path"

type SandboxSchemaType = DomainInstantSchema<typeof sandboxSchemaDomain>

export interface SandboxRecord {
  id: string
  externalSandboxId?: string
  sandboxUserId?: string
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

export type SandboxProcessStatus =
  | "starting"
  | "running"
  | "detached"
  | "exited"
  | "failed"
  | "killed"
  | "lost"

export type SandboxProcessKind =
  | "command"
  | "service"
  | "codex-app-server"
  | "dev-server"
  | "test-runner"
  | "watcher"

export type SandboxProcessMode = "foreground" | "background"

export type SandboxProcessStreamChunk = {
  version: 1
  at: string
  seq: number
  type: "stdout" | "stderr" | "status" | "exit" | "error" | "heartbeat" | "metadata"
  sandboxId: string
  processId: string
  data?: Record<string, unknown>
}

export type SandboxProcessRunResult = {
  processId: string
  streamId: string
  streamClientId: string
  result?: CommandResult
}

export type SandboxCommandRunData = {
  sandboxId: string
  processId: string
  streamId: string
  streamClientId: string
  result?: CommandResult
}

const EKAIROS_ROOT_DIR = "/vercel/sandbox/.ekairos"
const EKAIROS_RUNTIME_MANIFEST_PATH = `${EKAIROS_ROOT_DIR}/runtime.json`
const EKAIROS_HTTP_HELPER_PATH = `${EKAIROS_ROOT_DIR}/instant-http.mjs`
const EKAIROS_QUERY_SCRIPT_PATH = `${EKAIROS_ROOT_DIR}/query.mjs`
const CODEX_HOME_DIR = "/vercel/sandbox/.codex"
const CODEX_SKILLS_DIR = `${CODEX_HOME_DIR}/skills`
const INSTANT_API_BASE_URL = "https://api.instantdb.com"
const SANDBOX_PROCESS_STREAM_VERSION = 1 as const
const SANDBOX_PROCESS_TERMINAL_STATUSES = new Set(["exited", "failed", "killed", "lost"])

type SandboxEkairosManifest = {
  version: 1
  instant: {
    apiBaseUrl: string
    appId: string
  }
  sandbox: {
    sandboxUserId: string
  }
  domain: {
    name: string
    contextString?: string
    schemaJson?: any
  }
  dataset?: {
    enabled: true
  }
}

type ResolvedEkairosBootstrap = {
  appId: string
  sandboxUserId: string
  scopedToken: string
  manifest: SandboxEkairosManifest
  networkPolicy: NetworkPolicy
  env: Record<string, string>
}

type SandboxInstalledSkill = {
  name: string
  rootDir: string
  files: Array<{ path: string; content: Buffer }>
}

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

function formatSandboxError(err: any): string {
  const base = err instanceof Error ? err.message : String(err)
  const text = typeof err?.text === "string" ? err.text.trim() : ""
  const json = err?.json ? JSON.stringify(err.json) : ""
  const detail = text || json
  if (!detail) return base
  return `${base}: ${detail}`
}

function nowIso() {
  return new Date().toISOString()
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sanitizeInstantString(value: string): string {
  return value.includes("\0") ? value.replace(/\0/g, "") : value
}

function sanitizeInstantValue<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeInstantString(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInstantValue(item)) as T
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const sanitized: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeInstantValue(entry)
    }
    return sanitized as T
  }
  return value
}

function createSandboxProcessStreamClientId(processId: string): string {
  const normalized = String(processId ?? "").trim()
  if (!normalized) throw new Error("sandbox_process_id_required")
  return `sandbox-process:${normalized}`
}

function encodeSandboxProcessStreamChunk(chunk: SandboxProcessStreamChunk): string {
  return `${JSON.stringify(chunk)}\n`
}

function parseSandboxProcessStreamChunk(value: string | unknown): SandboxProcessStreamChunk {
  const parsed = typeof value === "string" ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid_sandbox_process_stream_chunk")
  }
  const record = parsed as Record<string, unknown>
  if (record.version !== SANDBOX_PROCESS_STREAM_VERSION) {
    throw new Error(`invalid_sandbox_process_stream_version:${String(record.version)}`)
  }
  return record as SandboxProcessStreamChunk
}

function sandboxProcessFinishedHookToken(processId: string): string {
  return `sandbox-process:${processId}:finished`
}

async function resumeSandboxProcessHook(processId: string, payload: unknown): Promise<void> {
  try {
    const { resumeHook } = await import("workflow/api")
    await resumeHook(sandboxProcessFinishedHookToken(processId), payload)
  } catch {
    // No workflow may be listening; process metadata and streams remain the source of truth.
  }
}

function commandResultFromProcessStream(params: {
  processRow: any
  chunks: SandboxProcessStreamChunk[]
}): CommandResult {
  const stdout = params.chunks
    .filter((chunk) => chunk.type === "stdout")
    .map((chunk) => String(chunk.data?.text ?? ""))
    .join("")
  const stderr = params.chunks
    .filter((chunk) => chunk.type === "stderr" || chunk.type === "error")
    .map((chunk) => String(chunk.data?.text ?? chunk.data?.message ?? ""))
    .join("")
  const exitChunk = [...params.chunks].reverse().find((chunk) => chunk.type === "exit")
  const exitCode = Number(exitChunk?.data?.exitCode ?? params.processRow?.exitCode ?? 1)
  const command = [
    String(params.processRow?.command ?? ""),
    ...(Array.isArray(params.processRow?.args) ? params.processRow.args : []),
  ]
    .filter(Boolean)
    .join(" ")

  return {
    success: exitCode === 0,
    exitCode,
    output: stdout,
    error: stderr,
    command,
  }
}

export class SandboxCommandRun implements PromiseLike<CommandResult> {
  private service: SandboxService | null = null
  private readonly data: SandboxCommandRunData

  constructor(data: SandboxCommandRunData, service?: SandboxService) {
    this.data = data
    this.service = service ?? null
  }

  get sandboxId() {
    return this.data.sandboxId
  }

  get processId() {
    return this.data.processId
  }

  get streamId() {
    return this.data.streamId
  }

  get streamClientId() {
    return this.data.streamClientId
  }

  private getService() {
    if (!this.service) {
      throw new Error("sandbox_command_run_service_required")
    }
    return this.service
  }

  async readStream(): Promise<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }> {
    const stream = await this.getService().readProcessStream(this.processId)
    if (!stream.ok) throw new Error(stream.error)
    return stream.data
  }

  async snapshot(): Promise<any> {
    const snapshot = await this.getService().getProcessSnapshot(this.processId)
    if (!snapshot.ok) throw new Error(snapshot.error)
    return snapshot.data
  }

  async wait(params?: { timeoutMs?: number; pollMs?: number }): Promise<CommandResult> {
    if (this.data.result) return this.data.result

    const initial = await this.snapshot()
    if (SANDBOX_PROCESS_TERMINAL_STATUSES.has(String(initial.status ?? ""))) {
      const stream = await this.readStream()
      const result = commandResultFromProcessStream({ processRow: initial, chunks: stream.chunks })
      this.data.result = result
      return result
    }

    try {
      const { createHook } = await import("workflow")
      const hook = createHook<CommandResult>({
        token: sandboxProcessFinishedHookToken(this.processId),
      })
      const result = await hook
      this.data.result = result
      return result
    } catch {
      // Outside workflow context, or if hooks are unavailable, poll the durable row.
    }

    const timeoutMs = Math.max(0, Number(params?.timeoutMs ?? 5 * 60 * 1000))
    const pollMs = Math.max(50, Number(params?.pollMs ?? 500))
    const deadline = Date.now() + timeoutMs

    while (Date.now() <= deadline) {
      const row = await this.snapshot()
      if (SANDBOX_PROCESS_TERMINAL_STATUSES.has(String(row.status ?? ""))) {
        const stream = await this.readStream()
        const result = commandResultFromProcessStream({ processRow: row, chunks: stream.chunks })
        this.data.result = result
        return result
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }

    throw new Error(`sandbox_process_wait_timeout:${this.processId}`)
  }

  then<TResult1 = CommandResult, TResult2 = never>(
    onfulfilled?: ((value: CommandResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.wait().then(onfulfilled, onrejected)
  }
}

export class SandboxService {
  private adminDb: InstantAdminDatabase<SandboxSchemaType, true>

  constructor(db: InstantAdminDatabase<SandboxSchemaType, true>) {
    this.adminDb = db
  }

  private static getDomainName(domain: RuntimeDomainSource): string {
    const metaName = typeof domain?.meta?.name === "string" ? domain.meta.name.trim() : ""
    const contextName = typeof (domain as any)?.context === "function" ? String((domain as any).context()?.name ?? "").trim() : ""
    return metaName || contextName || "domain"
  }

  private static getDomainContextString(domain: RuntimeDomainSource): string {
    if (typeof domain?.contextString !== "function") return ""
    try {
      return String(domain.contextString() ?? "").trim()
    } catch {
      return ""
    }
  }

  private static cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  private static buildEkairosNetworkPolicy(params: { scopedToken: string; datasetEnabled: boolean }): NetworkPolicy {
    const allow: Record<string, any[]> = {
      "api.instantdb.com": [
        {
          transform: [
            {
              headers: {
                "as-token": params.scopedToken,
              },
            },
          ],
        },
      ],
    }

    if (params.datasetEnabled) {
      allow["pypi.org"] = []
      allow["files.pythonhosted.org"] = []
      allow["*.pythonhosted.org"] = []
    }

    return {
      allow,
    }
  }

  private static buildEkairosManifest(params: {
    appId: string
    sandboxUserId: string
    domain: RuntimeDomainSource
    datasetEnabled: boolean
  }): SandboxEkairosManifest {
    const contextString = SandboxService.getDomainContextString(params.domain)
    const schemaJson = SandboxService.cloneJson(
      typeof (params.domain as any).instantSchema === "function"
        ? (params.domain as any).instantSchema()
        : (params.domain as any).toInstantSchema(),
    )
    return {
      version: 1,
      instant: {
        apiBaseUrl: INSTANT_API_BASE_URL,
        appId: params.appId,
      },
      sandbox: {
        sandboxUserId: params.sandboxUserId,
      },
      domain: {
        name: SandboxService.getDomainName(params.domain),
        ...(contextString ? { contextString } : {}),
        schemaJson,
      },
      ...(params.datasetEnabled ? { dataset: { enabled: true } } : {}),
    }
  }

  private static buildEkairosRuntimeFiles(manifest: SandboxEkairosManifest): Array<{ path: string; content: Buffer }> {
    const httpHelper = [
      "import { readFile } from 'node:fs/promises'",
      "import { randomUUID } from 'node:crypto'",
      "",
      "export async function readRuntimeManifest(manifestPath) {",
      `  const resolvedPath = manifestPath || ${JSON.stringify(EKAIROS_RUNTIME_MANIFEST_PATH)}`,
      "  return JSON.parse(await readFile(resolvedPath, 'utf8'))",
      "}",
      "",
      "export async function instantQuery(query, manifestPath) {",
      "  const manifest = await readRuntimeManifest(manifestPath)",
      "  const response = await fetch(`${manifest.instant.apiBaseUrl}/admin/query`, {",
      "    method: 'POST',",
      "    headers: {",
      "      'content-type': 'application/json',",
      "      'app-id': manifest.instant.appId,",
      "    },",
      "    body: JSON.stringify({ query }),",
      "  })",
      "  const text = await response.text()",
      "  if (!response.ok) {",
      "    throw new Error(JSON.stringify({ status: response.status, body: text }))",
      "  }",
      "  return text ? JSON.parse(text) : {}",
      "}",
      "",
      "export async function instantTransact(steps, manifestPath) {",
      "  const manifest = await readRuntimeManifest(manifestPath)",
      "  const response = await fetch(`${manifest.instant.apiBaseUrl}/admin/transact`, {",
      "    method: 'POST',",
      "    headers: {",
      "      'content-type': 'application/json',",
      "      'app-id': manifest.instant.appId,",
      "    },",
      "    body: JSON.stringify({ steps, 'throw-on-missing-attrs?': true }),",
      "  })",
      "  const text = await response.text()",
      "  if (!response.ok) {",
      "    throw new Error(JSON.stringify({ status: response.status, body: text }))",
      "  }",
      "  return text ? JSON.parse(text) : {}",
      "}",
      "",
      "export function newId() {",
      "  return randomUUID()",
      "}",
      "",
      "export function decodeArg(encodedJson) {",
      "  return JSON.parse(Buffer.from(encodedJson, 'base64url').toString('utf8'))",
      "}",
      "",
    ].join("\n")

    const queryScript = [
      `import { decodeArg, instantQuery } from ${JSON.stringify(EKAIROS_HTTP_HELPER_PATH)}`,
      "",
      "const encodedQuery = process.argv[2] ?? ''",
      `const manifestPath = process.argv[3] ?? ${JSON.stringify(EKAIROS_RUNTIME_MANIFEST_PATH)}`,
      "",
      "if (!encodedQuery) {",
      "  console.error('ekairos_query_required')",
      "  process.exit(1)",
      "}",
      "",
      "const query = decodeArg(encodedQuery)",
      "try {",
      "  const result = await instantQuery(query, manifestPath)",
      "  process.stdout.write(JSON.stringify(result))",
      "} catch (error) {",
      "  console.error(error instanceof Error ? error.message : String(error))",
      "  process.exit(1)",
      "}",
      "",
    ].join("\n")

    const files: Array<{ path: string; content: Buffer }> = [
      {
        path: EKAIROS_HTTP_HELPER_PATH,
        content: Buffer.from(httpHelper, "utf8"),
      },
      {
        path: EKAIROS_RUNTIME_MANIFEST_PATH,
        content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      },
      {
        path: EKAIROS_QUERY_SCRIPT_PATH,
        content: Buffer.from(queryScript, "utf8"),
      },
    ]

    return files
  }

  private static async resolveInstantUserIdByRefreshToken(params: {
    appId: string
    adminToken: string
    refreshToken: string
  }): Promise<string> {
    const response = await fetch(
      `${INSTANT_API_BASE_URL}/admin/users?refresh_token=${encodeURIComponent(params.refreshToken)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${params.adminToken}`,
          "app-id": params.appId,
        },
      },
    )

    const text = await response.text()
    let parsed: any = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (!response.ok) {
      throw new Error(parsed?.message || parsed?.error || text || "instant_refresh_token_lookup_failed")
    }

    const userId = String(parsed?.user?.id ?? "").trim()
    if (!userId) {
      throw new Error("instant_refresh_token_user_id_missing")
    }
    return userId
  }

  private static async resolveEkairosBootstrap(config: SandboxConfig): Promise<ResolvedEkairosBootstrap | null> {
    const hasRuntimeBinding = config.env !== undefined || config.domain !== undefined
    if (!hasRuntimeBinding) return null
    if (!config.env || !config.domain) {
      throw new Error("sandbox_runtime_requires_env_and_domain")
    }

    const provider = resolveProvider(config)
    if (provider !== "vercel") {
      throw new Error("ekairos_runtime_requires_vercel_provider")
    }
    const datasetEnabled = Boolean(config.dataset?.enabled)

    const runtime = await resolveRuntime(
      config.domain as RuntimeDomainSource,
      config.env as Record<string, unknown>,
    )

    const adminDb = (runtime as any)?.db
    const appId = String(adminDb?.config?.appId ?? "").trim()
    const adminToken = String(adminDb?.config?.adminToken ?? "").trim()

    if (!adminDb || !appId || !adminToken) {
      throw new Error("ekairos_runtime_admin_db_required")
    }

    const provisionalSandboxUserId = randomUUID()
    const scopedToken = await adminDb.auth.createToken({ id: provisionalSandboxUserId })
    const sandboxUserId = await SandboxService.resolveInstantUserIdByRefreshToken({
      appId,
      adminToken,
      refreshToken: scopedToken,
    })

    return {
      appId,
      sandboxUserId,
      scopedToken,
      manifest: SandboxService.buildEkairosManifest({
        appId,
        sandboxUserId,
        domain: config.domain,
        datasetEnabled,
      }),
      networkPolicy: SandboxService.buildEkairosNetworkPolicy({ scopedToken, datasetEnabled }),
      env: {
        EKAIROS_RUNTIME_MANIFEST_PATH: EKAIROS_RUNTIME_MANIFEST_PATH,
        EKAIROS_SANDBOX_USER_ID: sandboxUserId,
        EKAIROS_INSTANT_APP_ID: appId,
        CODEX_HOME: CODEX_HOME_DIR,
      },
    }
  }

  private static async bootstrapEkairosFiles(sandbox: VercelSandbox, manifest: SandboxEkairosManifest): Promise<void> {
    await SandboxService.safeMkDir(sandbox, EKAIROS_ROOT_DIR)
    await SandboxService.safeMkDir(sandbox, CODEX_HOME_DIR)
    await SandboxService.safeMkDir(sandbox, CODEX_SKILLS_DIR)
    await sandbox.writeFiles(SandboxService.buildEkairosRuntimeFiles(manifest))
  }

  private static async safeMkDir(sandbox: VercelSandbox, dirPath: string): Promise<void> {
    try {
      await sandbox.mkDir(dirPath)
    } catch (error) {
      const message = formatSandboxError(error)
      if (message.includes("File exists")) {
        return
      }
      throw error
    }
  }

  private static buildSkillInstallSet(skills: SandboxInstallableSkill[]): SandboxInstalledSkill[] {
    return skills.map((skill) => {
      const skillName = String(skill.name ?? "").trim()
      if (!skillName) {
        throw new Error("sandbox_skill_name_required")
      }

      const rootDir = `${CODEX_SKILLS_DIR}/${skillName}`
      const files = (skill.files ?? []).map((file) => {
        const relativePath = String(file.path ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim()
        if (!relativePath) {
          throw new Error(`sandbox_skill_file_path_required:${skillName}`)
        }
        return {
          path: `${rootDir}/${relativePath}`,
          content: Buffer.from(String(file.contentBase64 ?? ""), "base64"),
        }
      })

      return {
        name: skillName,
        rootDir,
        files,
      }
    })
  }

  private static async bootstrapSkills(
    sandbox: VercelSandbox,
    skills: SandboxInstallableSkill[],
  ): Promise<Array<{ name: string; rootDir: string; fileCount: number }>> {
    const installSet = SandboxService.buildSkillInstallSet(skills)
    if (installSet.length === 0) return []

    await SandboxService.safeMkDir(sandbox, CODEX_HOME_DIR)
    await SandboxService.safeMkDir(sandbox, CODEX_SKILLS_DIR)
    for (const skill of installSet) {
      await SandboxService.safeMkDir(sandbox, skill.rootDir)
      const parentDirs = Array.from(
        new Set(
          skill.files
            .map((file) => path.posix.dirname(file.path))
            .filter((dirPath) => dirPath && dirPath !== "." && dirPath !== skill.rootDir),
        ),
      ).sort((a, b) => a.length - b.length)
      for (const dirPath of parentDirs) {
        await SandboxService.safeMkDir(sandbox, dirPath)
      }
      await sandbox.writeFiles(skill.files)
    }

    return installSet.map((skill) => ({
      name: skill.name,
      rootDir: skill.rootDir,
      fileCount: skill.files.length,
    }))
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

  async createSandbox(config: SandboxConfig): Promise<ServiceResult<{ sandboxId: string }>> {
    const sandboxId = id()
    const now = Date.now()
    const provider = resolveProvider(config)
    const resolvedVercel =
      provider === "vercel" ? resolveVercelSandboxConfig(config, { sandboxId }) : undefined
    let daytonaEphemeral: boolean | undefined = undefined
    let installedSkills: Array<{ name: string; rootDir: string; fileCount: number }> = []

    try {
      const ekairos = await SandboxService.resolveEkairosBootstrap(config)
      const baseParams =
        config.params && typeof config.params === "object" && !Array.isArray(config.params) ? config.params : {}

      await this.adminDb.transact(
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          status: "creating",
          ...(ekairos ? { sandboxUserId: ekairos.sandboxUserId } : {}),
          provider,
          timeout: resolvedVercel?.timeoutMs ?? config.timeoutMs,
          runtime: resolvedVercel?.runtime ?? config.runtime,
          vcpus: resolvedVercel?.vcpus ?? config.resources?.vcpus,
          ports: (resolvedVercel?.ports ?? config.ports) as any,
          purpose: config.purpose,
          params: {
            ...baseParams,
            ...(resolvedVercel ? { vercel: safeVercelConfigForRecord(config, resolvedVercel) } : {}),
            ...(ekairos
              ? {
                  ekairos: {
                    enabled: true,
                    sandboxUserId: ekairos.sandboxUserId,
                    instant: {
                      appId: ekairos.appId,
                      apiBaseUrl: ekairos.manifest.instant.apiBaseUrl,
                    },
                    bootstrap: {
                      manifestPath: EKAIROS_RUNTIME_MANIFEST_PATH,
                      queryScriptPath: EKAIROS_QUERY_SCRIPT_PATH,
                    },
                    domain: ekairos.manifest.domain,
                    ...(config.dataset?.enabled ? { dataset: { enabled: true } } : {}),
                    ...(Array.isArray(config.skills) && config.skills.length > 0
                      ? {
                          skills: config.skills.map((skill) => ({
                            name: skill.name,
                            fileCount: Array.isArray(skill.files) ? skill.files.length : 0,
                          })),
                        }
                      : {}),
                  },
                }
              : {}),
          },
          createdAt: now,
          updatedAt: now,
        }),
      )

      let sandbox: ProviderSandbox | null = null
      try {
        if (provider === "daytona") {
          const daytona = new Daytona(getDaytonaConfig())
          const language = resolveDaytonaLanguage(config)
          const requestedVolumes = config.daytona?.volumes ?? []
          const volumes = await resolveDaytonaVolumes(daytona, requestedVolumes)
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
          const declarativeImage = buildDeclarativeImage(config)
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
          sandbox = await provisionSpritesSandbox({
            sandboxId,
            config,
          })
        } else {
          const vercelEnv = {
            ...(Array.isArray(config.skills) && config.skills.length > 0 ? { CODEX_HOME: CODEX_HOME_DIR } : {}),
            ...(ekairos?.env ?? {}),
          }
          sandbox = await provisionVercelSandbox(config, {
            networkPolicy: ekairos?.networkPolicy,
            env: Object.keys(vercelEnv).length > 0 ? vercelEnv : undefined,
            resolved: resolvedVercel,
          })
          if (ekairos) {
            await SandboxService.bootstrapEkairosFiles(sandbox as VercelSandbox, ekairos.manifest)
          }
          if (Array.isArray(config.skills) && config.skills.length > 0) {
            installedSkills = await SandboxService.bootstrapSkills(sandbox as VercelSandbox, config.skills)
          }
        }
      } catch (e) {
        const msg = formatSandboxError(e)
        if (sandbox && provider === "vercel") {
          try {
            await (sandbox as VercelSandbox).stop({ blocking: true })
            if (resolvedVercel?.deleteOnStop) {
              await (sandbox as VercelSandbox).delete()
            }
          } catch {
            // ignore cleanup errors during failed bootstrap
          }
        }
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
            : (sandbox as VercelSandbox).name

      const sandboxUrl = provider === "sprites" ? (sandbox as SpritesSandbox).url : undefined

      const activateMutations: any[] = [
        this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
          status: "active",
          externalSandboxId,
          ...(ekairos ? { sandboxUserId: ekairos.sandboxUserId } : {}),
          ...(sandboxUrl ? { sandboxUrl } : {}),
          updatedAt: Date.now(),
          params: {
            ...baseParams,
            ...(ekairos
              ? {
                  ekairos: {
                    enabled: true,
                    sandboxUserId: ekairos.sandboxUserId,
                    instant: {
                      appId: ekairos.appId,
                      apiBaseUrl: ekairos.manifest.instant.apiBaseUrl,
                    },
                    bootstrap: {
                      manifestPath: EKAIROS_RUNTIME_MANIFEST_PATH,
                      queryScriptPath: EKAIROS_QUERY_SCRIPT_PATH,
                    },
                    domain: ekairos.manifest.domain,
                    ...(config.dataset?.enabled ? { dataset: { enabled: true } } : {}),
                    ...(installedSkills.length > 0 ? { skills: installedSkills } : {}),
                  },
                }
              : {}),
            ...(provider === "vercel"
              ? {
                  vercel: resolvedVercel ? safeVercelConfigForRecord(config, resolvedVercel) : {},
                }
              : {}),
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
      ]
      if (ekairos) {
        activateMutations.push(this.adminDb.tx.sandbox_sandboxes[sandboxId].link({ user: ekairos.sandboxUserId }))
      }
      await this.adminDb.transact(activateMutations)

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
        const daytona = new Daytona(getDaytonaConfig())
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
          const spriteRes = await getSpritesByName(name)
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
          const spritesSandbox = asSpritesSandbox({
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

      const creds = await resolveVercelCredentials(record?.params ?? {})

      try {
        const maxAttempts = 20
        const delayMs = 500

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const sandbox = await VercelSandbox.get({
            name: String(record.externalSandboxId),
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

  private async getSandboxRecord(sandboxId: string): Promise<any | null> {
    const query = {
      sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 }, user: {} },
    } satisfies InstaQLParams<SandboxSchemaType>
    const recordResult: any = await this.adminDb.query(query)
    return recordResult?.sandbox_sandboxes?.[0] ?? null
  }

  async getProcessSnapshot(processId: string): Promise<ServiceResult<any>> {
    try {
      const query = {
        sandbox_processes: {
          $: { where: { id: processId } as any, limit: 1 },
          sandbox: {},
        },
      } satisfies InstaQLParams<SandboxSchemaType>
      const processResult: any = await this.adminDb.query(query)
      const processRow = processResult?.sandbox_processes?.[0]
      if (!processRow) return { ok: false, error: "sandbox_process_not_found" }
      return { ok: true, data: processRow }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  private async markOpenProcessesLost(sandboxId: string, reason: string): Promise<void> {
    try {
      const processResult: any = await this.adminDb.query({
        sandbox_processes: {
          $: {
            where: { "sandbox.id": sandboxId } as any,
            limit: 500,
          },
        },
      })
      const rows = Array.isArray(processResult?.sandbox_processes)
        ? processResult.sandbox_processes
        : []
      const now = Date.now()
      const txs = rows
        .filter((row: any) => !SANDBOX_PROCESS_TERMINAL_STATUSES.has(String(row?.status ?? "")))
        .map((row: any) =>
          this.adminDb.tx.sandbox_processes[String(row.id)].update({
            status: "lost",
            streamFinishedAt: row.streamFinishedAt ?? now,
            streamAbortReason: reason,
            exitedAt: now,
            updatedAt: now,
            metadata: {
              ...(row.metadata ?? {}),
              lostReason: reason,
            },
          }),
        )
      if (txs.length > 0) {
        await this.adminDb.transact(txs)
      }
    } catch {
      // Best-effort cleanup; stopping the sandbox should not fail because process metadata could not be marked.
    }
  }

  private async createProcessStream(params: {
    sandboxId: string
    processId: string
    streamClientId?: string
  }): Promise<{
    stream: WritableStream<string>
    streamId: string
    streamClientId: string
  }> {
    const streams = (this.adminDb as any)?.streams
    if (!streams?.createWriteStream) {
      throw new Error("sandbox_process_streams_unavailable")
    }

    const streamClientId = params.streamClientId || createSandboxProcessStreamClientId(params.processId)
    const stream = streams.createWriteStream({ clientId: streamClientId }) as WritableStream<string> & {
      streamId?: () => Promise<string>
    }
    const streamId = typeof stream.streamId === "function" ? await stream.streamId() : streamClientId

    return { stream, streamId, streamClientId }
  }

  private async writeProcessChunk(params: {
    writer: WritableStreamDefaultWriter<string>
    sandboxId: string
    processId: string
    seq: number
    type: SandboxProcessStreamChunk["type"]
    data?: Record<string, unknown>
  }) {
    await params.writer.write(
      encodeSandboxProcessStreamChunk({
        version: SANDBOX_PROCESS_STREAM_VERSION,
        at: nowIso(),
        seq: params.seq,
        type: params.type,
        sandboxId: params.sandboxId,
        processId: params.processId,
        ...(params.data ? { data: sanitizeInstantValue(params.data) } : {}),
      }),
    )
  }

  private async readProcessRow(processId: string): Promise<any | null> {
    const query = {
      sandbox_processes: {
        $: { where: { id: processId } as any, limit: 1 },
        sandbox: {},
      },
    } satisfies InstaQLParams<SandboxSchemaType>
    const result: any = await this.adminDb.query(query)
    return result?.sandbox_processes?.[0] ?? null
  }

  private async writeProcessChunkByProcessId(
    processId: string,
    type: SandboxProcessStreamChunk["type"],
    data?: Record<string, unknown>,
    opts?: { close?: boolean },
  ): Promise<void> {
    const row = await this.readProcessRow(processId)
    if (!row) throw new Error("sandbox_process_not_found")
    const linkedSandbox = Array.isArray(row?.sandbox) ? row.sandbox[0] : row?.sandbox
    const sandboxId = String(linkedSandbox?.id ?? row?.sandboxId ?? "").trim()
    if (!sandboxId) throw new Error("sandbox_process_sandbox_missing")
    const streamClientId = String(row.streamClientId ?? "").trim() || createSandboxProcessStreamClientId(processId)
    const streams = (this.adminDb as any)?.streams
    if (!streams?.createWriteStream) throw new Error("sandbox_process_streams_unavailable")
    const stream = streams.createWriteStream({ clientId: streamClientId }) as WritableStream<string>
    const writer = stream.getWriter()
    try {
      const seq = Number(row.metadata?.lastSeq ?? row.metadata?.chunkCount ?? 0) + 1
      await this.writeProcessChunk({
        writer,
        sandboxId,
        processId,
        seq,
        type,
        data,
      })
      if (opts?.close) {
        await writer.close()
      }
      await this.adminDb.transact([
        this.adminDb.tx.sandbox_processes[processId].update({
          updatedAt: Date.now(),
          metadata: sanitizeInstantValue({
            ...(row.metadata ?? {}),
            lastSeq: seq,
            chunkCount: seq,
          }),
        }),
      ] as any)
    } finally {
      try {
        writer.releaseLock()
      } catch {
        // ignore
      }
    }
  }

  async startObservedProcess(
    sandboxId: string,
    opts: {
      command: string
      args?: string[]
      cwd?: string
      env?: Record<string, unknown>
      kind?: SandboxProcessKind
      mode?: SandboxProcessMode
      externalProcessId?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<ServiceResult<SandboxProcessRunResult>> {
    const processId = id()
    const now = Date.now()
    try {
      const record = await this.getSandboxRecord(sandboxId)
      if (!record) return { ok: false, error: "Valid sandbox record not found" }
      if (record.status !== "active") return { ok: false, error: `sandbox_not_active:${record.status}` }

      const streamSession = await this.createProcessStream({ sandboxId, processId })
      const stream = streamSession.stream
      const writer = stream.getWriter()
      try {
        await this.adminDb.transact([
          this.adminDb.tx.sandbox_processes[processId]
            .update({
              kind: opts.kind ?? "command",
              mode: opts.mode ?? "foreground",
              status: "running",
              provider: String(record.provider ?? "unknown"),
              command: sanitizeInstantString(opts.command),
              args: sanitizeInstantValue(Array.isArray(opts.args) ? opts.args : []),
              cwd: asOptionalString(opts.cwd),
              env: sanitizeInstantValue(opts.env),
              externalProcessId: asOptionalString(opts.externalProcessId),
              streamId: streamSession.streamId,
              streamClientId: streamSession.streamClientId,
              streamStartedAt: now,
              startedAt: now,
              updatedAt: now,
              metadata: sanitizeInstantValue({
                ...(opts.metadata ?? {}),
                observed: true,
                lastSeq: 1,
                chunkCount: 1,
              }),
            })
            .link({ sandbox: sandboxId, stream: streamSession.streamId }),
        ] as any)

        await this.writeProcessChunk({
          writer,
          sandboxId,
          processId,
          seq: 1,
          type: "status",
          data: {
            status: "running",
            command: opts.command,
            args: Array.isArray(opts.args) ? opts.args : [],
            cwd: opts.cwd ?? null,
            externalProcessId: opts.externalProcessId ?? null,
          },
        })
        // Keep observed-process streams open across calls; finishObservedProcess closes them.
      } finally {
        try {
          writer.releaseLock()
        } catch {
          // ignore
        }
      }

      return {
        ok: true,
        data: {
          processId,
          streamId: streamSession.streamId,
          streamClientId: streamSession.streamClientId,
        },
      }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async appendObservedProcessChunk(
    processId: string,
    type: SandboxProcessStreamChunk["type"],
    data?: Record<string, unknown>,
  ): Promise<ServiceResult<void>> {
    try {
      await this.writeProcessChunkByProcessId(processId, type, data)
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async finishObservedProcess(
    processId: string,
    opts?: {
      status?: "exited" | "failed" | "killed" | "lost"
      exitCode?: number
      errorText?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<ServiceResult<void>> {
    try {
      const row = await this.readProcessRow(processId)
      if (!row) return { ok: false, error: "sandbox_process_not_found" }
      const exitCode = Number.isFinite(Number(opts?.exitCode)) ? Number(opts?.exitCode) : undefined
      const status = opts?.status ?? (exitCode === undefined || exitCode === 0 ? "exited" : "failed")
      await this.writeProcessChunkByProcessId(
        processId,
        status === "failed" ? "error" : "exit",
        {
          exitCode: exitCode ?? null,
          status,
          ...(opts?.errorText ? { message: opts.errorText } : {}),
        },
        { close: true },
      )
      const finishedAt = Date.now()
      await this.adminDb.transact([
        this.adminDb.tx.sandbox_processes[processId].update({
          status,
          ...(exitCode !== undefined ? { exitCode } : {}),
          streamFinishedAt: finishedAt,
          streamAbortReason: opts?.errorText ?? null,
          exitedAt: finishedAt,
          updatedAt: finishedAt,
          metadata: sanitizeInstantValue({
            ...(row.metadata ?? {}),
            ...(opts?.metadata ?? {}),
            ...(opts?.errorText ? { error: opts.errorText } : {}),
          }),
        }),
      ] as any)
      return { ok: true, data: undefined }
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
          : record?.provider === "vercel"
            ? SandboxService.parseOptionalBoolean(process.env.SANDBOX_VERCEL_DELETE_ON_STOP) ??
              Boolean(record?.params?.vercel?.deleteOnStop ?? !record?.params?.vercel?.persistent)
            : SandboxService.parseOptionalBoolean(process.env.SANDBOX_DAYTONA_DELETE_ON_STOP) ??
              Boolean(record?.params?.daytona?.ephemeral)
      if (result.ok) {
        try {
          const sandbox: any = result.data.sandbox as any
          if (isVercelSandbox(sandbox)) {
            await (sandbox as VercelSandbox).stop({ blocking: true })
            if (deleteOnStop) {
              await (sandbox as VercelSandbox).delete()
            }
          } else if (sandbox?.__provider === "sprites") {
            // Sprites does not have a reliable "stop" semantic; deleting is the durable cleanup primitive.
            try {
              await spritesFetch(`/v1/sprites/${encodeURIComponent(String(sandbox.name))}`, {
                method: "DELETE",
              })
            } catch {
              // ignore delete errors
            }
          } else {
            const daytona = new Daytona(getDaytonaConfig())
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
      await this.markOpenProcessesLost(sandboxId, "sandbox_stopped")

      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async query(sandboxId: string, query: Record<string, any>): Promise<ServiceResult<any>> {
    try {
      const record = await this.getSandboxRecord(sandboxId)
      if (!record) {
        return { ok: false, error: "Valid sandbox record not found" }
      }

      if (record.provider !== "vercel") {
        return { ok: false, error: "sandbox_query_requires_vercel_provider" }
      }

      const queryScriptPath = String(record?.params?.ekairos?.bootstrap?.queryScriptPath ?? "").trim()
      if (!queryScriptPath) {
        return { ok: false, error: "sandbox_query_not_configured" }
      }

      const manifestPath =
        String(record?.params?.ekairos?.bootstrap?.manifestPath ?? "").trim() || EKAIROS_RUNTIME_MANIFEST_PATH
      const encodedQuery = Buffer.from(JSON.stringify(query), "utf8").toString("base64url")

      const result = await this.runCommand(sandboxId, "node", [queryScriptPath, encodedQuery, manifestPath])
      if (!result.ok) {
        return result as ServiceResult<any>
      }

      const stdout = String(result.data.output ?? "").trim()
      if (!stdout) {
        return { ok: false, error: "sandbox_query_empty_response" }
      }

      try {
        return { ok: true, data: JSON.parse(stdout) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `sandbox_query_invalid_json: ${message}` }
      }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
  }

  async runCommand(sandboxId: string, command: string, args: string[] = []): Promise<ServiceResult<CommandResult>> {
    try {
      const sandboxResult = await this.reconnectToSandbox(sandboxId)
      if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }

      const sandbox = sandboxResult.data.sandbox
      if (isVercelSandbox(sandbox)) {
        const result = await runCommandInSandbox(sandbox as VercelSandbox, command, args)
        return { ok: true, data: result }
      }

      if ((sandbox as any).__provider === "sprites") {
        const fullCommand = args.length > 0 ? [command, ...args].join(" ") : command
        const res = await spritesExec({
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

  async runCommandProcess(
    sandboxId: string,
    command: string,
    args: string[] = [],
    opts?: {
      cwd?: string
      env?: Record<string, unknown>
      kind?: SandboxProcessKind
      mode?: SandboxProcessMode
      metadata?: Record<string, unknown>
    },
  ): Promise<ServiceResult<SandboxCommandRun>> {
    const processId = id()
    const now = Date.now()
    let writer: WritableStreamDefaultWriter<string> | null = null
    let stream: WritableStream<string> | null = null
    let seq = 0

    try {
      const record = await this.getSandboxRecord(sandboxId)
      if (!record) return { ok: false, error: "Valid sandbox record not found" }
      if (record.status !== "active") return { ok: false, error: `sandbox_not_active:${record.status}` }

      const streamSession = await this.createProcessStream({ sandboxId, processId })
      stream = streamSession.stream
      writer = stream.getWriter()

      await this.adminDb.transact([
        this.adminDb.tx.sandbox_processes[processId]
          .update({
            kind: opts?.kind ?? "command",
            mode: opts?.mode ?? "foreground",
            status: "running",
            provider: String(record.provider ?? "unknown"),
            command: sanitizeInstantString(command),
            args: sanitizeInstantValue(Array.isArray(args) ? args : []),
            cwd: asOptionalString(opts?.cwd),
            env: sanitizeInstantValue(opts?.env),
            streamId: streamSession.streamId,
            streamClientId: streamSession.streamClientId,
            streamStartedAt: now,
            startedAt: now,
            updatedAt: now,
            metadata: sanitizeInstantValue(opts?.metadata),
          })
          .link({ sandbox: sandboxId, stream: streamSession.streamId }),
      ] as any)

      seq += 1
      await this.writeProcessChunk({
        writer,
        sandboxId,
        processId,
        seq,
        type: "status",
        data: {
          status: "running",
          command,
          args: Array.isArray(args) ? args : [],
          cwd: opts?.cwd ?? null,
        },
      })

      const result = await this.runCommand(sandboxId, command, args)
      const finishedAt = Date.now()
      let finalResult: CommandResult
      let status: SandboxProcessStatus
      let exitCode: number
      let errorText: string | undefined

      if (result.ok) {
        finalResult = result.data
        exitCode = Number(result.data.exitCode ?? (result.data.success === false ? 1 : 0))
        status = exitCode === 0 ? "exited" : "failed"
        const stdout = String((result.data as any).stdout ?? result.data.output ?? "")
        const stderr = String((result.data as any).stderr ?? result.data.error ?? "")
        if (stdout) {
          seq += 1
          await this.writeProcessChunk({
            writer,
            sandboxId,
            processId,
            seq,
            type: "stdout",
            data: { text: stdout },
          })
        }
        if (stderr) {
          seq += 1
          await this.writeProcessChunk({
            writer,
            sandboxId,
            processId,
            seq,
            type: "stderr",
            data: { text: stderr },
          })
        }
      } else {
        exitCode = 1
        status = "failed"
        errorText = result.error
        finalResult = {
          success: false,
          exitCode,
          output: "",
          error: result.error,
          command: [command, ...(Array.isArray(args) ? args : [])].join(" "),
        }
        seq += 1
        await this.writeProcessChunk({
          writer,
          sandboxId,
          processId,
          seq,
          type: "error",
          data: { message: result.error },
        })
      }

      seq += 1
      await this.writeProcessChunk({
        writer,
        sandboxId,
        processId,
        seq,
        type: "exit",
        data: { exitCode, status },
      })

      await writer.close()
      writer = null

      await this.adminDb.transact([
        this.adminDb.tx.sandbox_processes[processId].update({
          status,
          exitCode,
          streamFinishedAt: finishedAt,
          streamAbortReason: null,
          exitedAt: finishedAt,
          updatedAt: finishedAt,
          metadata: sanitizeInstantValue({
            ...(opts?.metadata ?? {}),
            ...(errorText ? { error: errorText } : {}),
            chunkCount: seq,
            result: finalResult,
          }),
        }),
      ] as any)

      await resumeSandboxProcessHook(processId, finalResult)

      return {
        ok: true,
        data: new SandboxCommandRun(
          {
            sandboxId,
            processId,
            streamId: streamSession.streamId,
            streamClientId: streamSession.streamClientId,
            result: finalResult,
          },
          this,
        ),
      }
    } catch (e) {
      const message = formatInstantSchemaError(e)
      const failedAt = Date.now()
      try {
        if (writer) {
          seq += 1
          await this.writeProcessChunk({
            writer,
            sandboxId,
            processId,
            seq,
            type: "error",
            data: { message },
          })
          await writer.abort(message)
          writer = null
        } else if (stream) {
          await stream.abort(message)
        }
      } catch {
        // ignore stream cleanup errors
      }
      try {
        const finalResult: CommandResult = {
          success: false,
          exitCode: 1,
          output: "",
          error: message,
          command: [command, ...(Array.isArray(args) ? args : [])].join(" "),
        }
        await this.adminDb.transact([
          this.adminDb.tx.sandbox_processes[processId].update({
            status: "failed",
            streamFinishedAt: failedAt,
            streamAbortReason: message,
            exitedAt: failedAt,
            updatedAt: failedAt,
            metadata: sanitizeInstantValue({
              ...(opts?.metadata ?? {}),
              error: message,
              result: finalResult,
            }),
          }),
        ] as any)
        await resumeSandboxProcessHook(processId, finalResult)
      } catch {
        // ignore partial metadata failures
      }
      return { ok: false, error: message }
    } finally {
      try {
        writer?.releaseLock()
      } catch {
        // ignore
      }
    }
  }

  async runCommandWithProcessStream(
    sandboxId: string,
    command: string,
    args: string[] = [],
    opts?: {
      cwd?: string
      env?: Record<string, unknown>
      kind?: SandboxProcessKind
      mode?: SandboxProcessMode
      metadata?: Record<string, unknown>
    },
  ): Promise<ServiceResult<SandboxProcessRunResult>> {
    const run = await this.runCommandProcess(sandboxId, command, args, opts)
    if (!run.ok) return run
    const result = await run.data
    return {
      ok: true,
      data: {
        processId: run.data.processId,
        streamId: run.data.streamId,
        streamClientId: run.data.streamClientId,
        result,
      },
    }
  }

  async readProcessStream(processId: string): Promise<ServiceResult<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }>> {
    try {
      const processResult: any = await this.adminDb.query({
        sandbox_processes: {
          $: { where: { id: processId } as any, limit: 1 },
        },
      })
      const processRow = processResult?.sandbox_processes?.[0]
      if (!processRow) return { ok: false, error: "sandbox_process_not_found" }

      const streams = (this.adminDb as any)?.streams
      if (!streams?.createReadStream) return { ok: false, error: "sandbox_process_streams_unavailable" }

      const clientId = String(processRow.streamClientId ?? "").trim() || undefined
      const streamId = String(processRow.streamId ?? "").trim() || undefined
      if (!clientId && !streamId) return { ok: false, error: "sandbox_process_stream_missing" }

      const stream = streams.createReadStream({ clientId, streamId })
      const chunks: SandboxProcessStreamChunk[] = []
      let byteOffset = 0
      let buffer = ""

      for await (const raw of stream as any) {
        const encoded = typeof raw === "string" ? raw : String(raw ?? "")
        if (!encoded) continue
        byteOffset += new TextEncoder().encode(encoded).length
        buffer += encoded
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          chunks.push(parseSandboxProcessStreamChunk(trimmed))
        }
      }

      const trailing = buffer.trim()
      if (trailing) chunks.push(parseSandboxProcessStreamChunk(trailing))

      return { ok: true, data: { chunks, byteOffset } }
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
      if (isVercelSandbox(sandbox)) {
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

          await spritesExec({
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
      if (isVercelSandbox(sandbox)) {
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

        const res = await spritesExec({
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

  async getPortUrl(sandboxId: string, port: number): Promise<ServiceResult<{ url: string }>> {
    try {
      const sandboxResult = await this.reconnectToSandbox(sandboxId)
      if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }

      const sandbox = sandboxResult.data.sandbox
      const normalizedPort = Math.max(1, Math.floor(Number(port)))

      if (isVercelSandbox(sandbox)) {
        const url = (sandbox as VercelSandbox).domain(normalizedPort)
        return { ok: true, data: { url: String(url ?? "").replace(/\/+$/, "") } }
      }

      if ((sandbox as any).__provider === "sprites") {
        const base = String((sandbox as any).url ?? "").trim().replace(/\/+$/, "")
        if (!base) return { ok: false, error: "sprites_url_missing" }
        if (normalizedPort === 8080) return { ok: true, data: { url: base } }
        try {
          const u = new URL(base)
          u.port = String(normalizedPort)
          return { ok: true, data: { url: u.toString().replace(/\/+$/, "") } }
        } catch {
          return { ok: true, data: { url: `${base}:${normalizedPort}` } }
        }
      }

      return { ok: false, error: "sandbox_port_url_not_supported" }
    } catch (e) {
      return { ok: false, error: formatInstantSchemaError(e) }
    }
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
      if (record?.externalSandboxId && record.provider === "vercel") {
        const sandboxResult = await this.reconnectToSandbox(sandboxId)
        if (!sandboxResult.ok) return { ok: false, error: sandboxResult.error }
        const sandbox = sandboxResult.data.sandbox
        if (!isVercelSandbox(sandbox)) return { ok: false, error: "checkpoint_not_supported" }

        const expiration = Number(record?.params?.vercel?.snapshotExpirationMs)
        const snapshot = await (sandbox as VercelSandbox).snapshot({
          ...(Number.isFinite(expiration) ? { expiration } : {}),
        })
        const checkpointId = String((snapshot as any)?.snapshotId ?? "").trim()
        if (!checkpointId) return { ok: false, error: "vercel_snapshot_id_missing" }

        await this.adminDb.transact(
          this.adminDb.tx.sandbox_sandboxes[sandboxId].update({
            updatedAt: Date.now(),
            params: {
              ...(record.params ?? {}),
              vercel: {
                ...(record.params?.vercel ?? {}),
                lastCheckpointId: checkpointId,
                lastCheckpointComment: String(params?.comment ?? "").trim() || undefined,
              },
            },
          }),
        )

        return { ok: true, data: { checkpointId } }
      }

      if (!record?.externalSandboxId || record.provider !== "sprites") {
        return { ok: false, error: "checkpoint_not_supported" }
      }

      const name = String(record.externalSandboxId).trim()
      const comment = String(params?.comment ?? "").trim()
      const body = comment ? { comment } : {}

      const res = await spritesFetch(`/v1/sprites/${encodeURIComponent(name)}/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const text = await res?.text?.().catch(() => "")
      if (!res?.ok) {
        return { ok: false, error: text || `sprites_checkpoint_http_${res?.status ?? "unknown"}` }
      }

      const checkpointId = parseSpritesCheckpointIdFromNdjson(text)
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
      if (record?.externalSandboxId && record.provider === "vercel") {
        const creds = await resolveVercelCredentials(record?.params ?? {})
        const listed = await VercelSnapshot.list({
          teamId: creds.teamId,
          projectId: creds.projectId,
          token: creds.token,
          name: String(record.externalSandboxId),
          limit: 50,
          sortOrder: "desc",
        } as any)
        const checkpointIds = (listed.snapshots ?? [])
          .map((snapshot: any) => String(snapshot?.id ?? "").trim())
          .filter(Boolean)
        return { ok: true, data: { checkpointIds } }
      }

      if (!record?.externalSandboxId || record.provider !== "sprites") {
        return { ok: false, error: "checkpoint_not_supported" }
      }

      const name = String(record.externalSandboxId).trim()
      const json = await spritesJson<any>(`/v1/sprites/${encodeURIComponent(name)}/checkpoints`, {
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

      const res = await spritesFetch(
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

