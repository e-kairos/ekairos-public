import { Daytona, Image, type DaytonaConfig } from "@daytonaio/sdk"

import type { SandboxConfig } from "../types.js"

export function getDaytonaConfig(): DaytonaConfig {
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
    throw new Error(
      "Missing required Daytona env vars: DAYTONA_API_KEY or DAYTONA_JWT_TOKEN + DAYTONA_ORGANIZATION_ID",
    )
  }

  return {
    apiUrl,
    target: target || undefined,
    apiKey: apiKey || undefined,
    jwtToken: jwtToken || undefined,
    organizationId: organizationId || undefined,
  }
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

function parseCsvList(value?: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function resolveDaytonaLanguage(
  config: SandboxConfig,
): "python" | "typescript" | "javascript" | undefined {
  if (config.daytona?.language) return config.daytona.language
  const runtime = String(config.runtime ?? "").toLowerCase()
  if (runtime.startsWith("python")) return "python"
  if (runtime.startsWith("node")) return "javascript"
  if (runtime.startsWith("ts") || runtime.includes("typescript")) return "typescript"
  return undefined
}

export async function resolveDaytonaVolumes(
  daytona: Daytona,
  volumes: Array<{ volumeId?: string; volumeName?: string; mountPath: string }>,
): Promise<Array<{ volumeId: string; mountPath: string }>> {
  if (!volumes || volumes.length === 0) return []

  const resolved: Array<{ volumeId: string; mountPath: string }> = []
  const shouldLog = parseOptionalBoolean(process.env.SANDBOX_DAYTONA_LOG_VOLUMES) ?? false
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
    const waitStates = new Set([
      "creating",
      "provisioning",
      "pending",
      "pending_create",
      "pending-create",
      "initializing",
    ])
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

function resolvePythonVersion(runtime?: string): string {
  const fromEnv =
    String(process.env.SANDBOX_DAYTONA_DECLARATIVE_PYTHON ?? "").trim() ||
    String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_PYTHON ?? "").trim()
  if (fromEnv) return fromEnv
  const match = String(runtime ?? "").match(/python\s*([0-9]+\.[0-9]+)/i)
  if (match?.[1]) return match[1]
  return "3.12"
}

export function buildDeclarativeImage(config: SandboxConfig): Image | undefined {
  const imageFlag = String(config.daytona?.image ?? "").trim()
  const envFlag =
    parseOptionalBoolean(process.env.SANDBOX_DAYTONA_DECLARATIVE_IMAGE) ??
    parseOptionalBoolean(process.env.STRUCTURE_DAYTONA_DECLARATIVE_IMAGE) ??
    false
  const useDeclarative = envFlag || imageFlag.startsWith("declarative")
  if (!useDeclarative) return undefined

  const baseImage =
    String(process.env.SANDBOX_DAYTONA_DECLARATIVE_BASE ?? "").trim() ||
    String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_BASE ?? "").trim()
  const pythonVersion = resolvePythonVersion(config.runtime)
  const isStructureDataset =
    config.purpose === "structure.dataset" || typeof (config.params as any)?.datasetId === "string"
  const defaultPackages = isStructureDataset ? ["pandas", "openpyxl"] : []
  const packages = [
    ...parseCsvList(process.env.SANDBOX_DAYTONA_DECLARATIVE_PIP),
    ...parseCsvList(process.env.STRUCTURE_DAYTONA_DECLARATIVE_PIP),
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
