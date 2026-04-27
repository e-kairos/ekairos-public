import { Sandbox as VercelSandbox, type NetworkPolicy } from "@vercel/sandbox"
import { execFile } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type { SandboxConfig } from "../types.js"
import {
  resolveVercelSandboxConfig,
  type ResolvedVercelSandboxConfig,
} from "../vercel-options.js"

const execFileAsync = promisify(execFile)

function formatSandboxError(err: any): string {
  const base = err instanceof Error ? err.message : String(err)
  const text = typeof err?.text === "string" ? err.text.trim() : ""
  const json = err?.json ? JSON.stringify(err.json) : ""
  const detail = text || json
  if (!detail) return base
  return `${base}: ${detail}`
}

export function resolveVercelWorkingDirectory(config: SandboxConfig): string {
  const fromConfig = String(config.vercel?.cwd ?? "").trim()
  if (fromConfig) return path.resolve(fromConfig)
  const fromEnv = String(process.env.SANDBOX_VERCEL_CWD ?? "").trim()
  if (fromEnv) return path.resolve(fromEnv)
  return process.cwd()
}

export function findLinkedVercelProjectFile(startDir: string): string | null {
  let current = path.resolve(startDir)
  while (true) {
    const candidate = path.join(current, ".vercel", "project.json")
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export async function readLinkedVercelProject(config: SandboxConfig): Promise<{
  orgId?: string
  projectId?: string
  projectName?: string
  cwd: string
}> {
  const cwd = resolveVercelWorkingDirectory(config)
  const file = findLinkedVercelProjectFile(cwd)
  if (!file) {
    return { cwd }
  }
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"))
    return {
      cwd,
      orgId: typeof parsed?.orgId === "string" ? parsed.orgId : undefined,
      projectId: typeof parsed?.projectId === "string" ? parsed.projectId : undefined,
      projectName: typeof parsed?.projectName === "string" ? parsed.projectName : undefined,
    }
  } catch {
    return { cwd }
  }
}

export async function pullVercelOidcToken(config: SandboxConfig): Promise<string> {
  const cwd = resolveVercelWorkingDirectory(config)
  const tmpPath = path.join(
    os.tmpdir(),
    `ekairos-vercel-env-${Date.now()}-${Math.random().toString(36).slice(2)}.env`,
  )
  const args = [
    "env",
    "pull",
    tmpPath,
    "--yes",
    "--environment",
    String(config.vercel?.environment ?? "development"),
  ]
  const scope = String(config.vercel?.scope ?? process.env.SANDBOX_VERCEL_SCOPE ?? "").trim()
  if (scope) {
    args.push("--scope", scope)
  }
  const token = String(
    process.env.VERCEL_TOKEN ?? process.env.SANDBOX_VERCEL_TOKEN ?? "",
  ).trim()
  if (token) {
    args.push("--token", token)
  }

  const isWindows = process.platform === "win32"
  const command = isWindows ? process.env.COMSPEC || "cmd.exe" : "vercel"
  const commandArgs = isWindows ? ["/c", "vercel", ...args] : args

  try {
    await execFileAsync(command, commandArgs, {
      cwd,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    })
    const content = await fs.readFile(tmpPath, "utf8")
    const match = content.match(/VERCEL_OIDC_TOKEN=\"?([^\r\n\"]+)\"?/)
    const oidc = String(match?.[1] ?? "").trim()
    if (!oidc) {
      throw new Error("VERCEL_OIDC_TOKEN missing from vercel env pull output")
    }
    return oidc
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
  }
}

export async function resolveVercelCredentials(config: SandboxConfig) {
  const explicitTeamId = String(
    config.vercel?.orgId ?? process.env.SANDBOX_VERCEL_TEAM_ID ?? "",
  ).trim()
  const explicitProjectId = String(
    config.vercel?.projectId ?? process.env.SANDBOX_VERCEL_PROJECT_ID ?? "",
  ).trim()
  const explicitToken = String(
    config.vercel?.token ??
      process.env.SANDBOX_VERCEL_TOKEN ??
      process.env.VERCEL_OIDC_TOKEN ??
      "",
  ).trim()
  if (explicitTeamId && explicitProjectId && explicitToken) {
    return { teamId: explicitTeamId, projectId: explicitProjectId, token: explicitToken }
  }

  const linked = await readLinkedVercelProject(config)
  const teamId = explicitTeamId || String(linked.orgId ?? "").trim()
  const projectId = explicitProjectId || String(linked.projectId ?? "").trim()
  let token = explicitToken
  if (!token) {
    token = await pullVercelOidcToken(config)
  }

  if (!teamId || !projectId || !token) {
    throw new Error(
      "Missing Vercel sandbox credentials. Link the project (`vercel link`) and ensure `vercel env pull` can resolve VERCEL_OIDC_TOKEN, or provide explicit SANDBOX_VERCEL_* env vars.",
    )
  }

  return { teamId, projectId, token }
}

export async function provisionVercelSandbox(
  config: SandboxConfig,
  extra?: {
    networkPolicy?: NetworkPolicy
    env?: Record<string, string>
    resolved?: ResolvedVercelSandboxConfig
  },
): Promise<VercelSandbox> {
  const creds = await resolveVercelCredentials(config)
  const resolved = extra?.resolved ?? resolveVercelSandboxConfig(config)

  if (resolved.reuse && resolved.name) {
    try {
      return await VercelSandbox.get({
        name: resolved.name,
        teamId: creds.teamId,
        projectId: creds.projectId,
        token: creds.token,
        resume: true,
      } as any)
    } catch (error: any) {
      const status = Number(error?.response?.status ?? 0)
      const message = formatSandboxError(error).toLowerCase()
      if (status !== 404 && !message.includes("not found")) {
        throw error
      }
    }
  }

  return await VercelSandbox.create({
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
    ...(resolved.name ? { name: resolved.name } : {}),
    timeout: resolved.timeoutMs,
    ports: resolved.ports,
    runtime: resolved.runtime as any,
    resources: { vcpus: resolved.vcpus },
    persistent: resolved.persistent,
    ...(resolved.snapshotExpirationMs !== undefined
      ? { snapshotExpiration: resolved.snapshotExpirationMs }
      : {}),
    ...(resolved.tags ? { tags: resolved.tags } : {}),
    networkPolicy: extra?.networkPolicy,
    env: extra?.env,
  } as any)
}
