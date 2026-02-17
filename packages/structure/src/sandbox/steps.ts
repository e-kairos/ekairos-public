import type { SandboxConfig } from "@ekairos/sandbox"
import { getDatasetWorkdirBase, getDaytonaVolumeMountPath, getDaytonaVolumeName } from "../datasetFiles.js"

export type DatasetSandboxId = string

export type CreateDatasetSandboxParams = Omit<SandboxConfig, "provider" | "daytona"> & {
  provider?: SandboxConfig["provider"]
  daytona?: SandboxConfig["daytona"]
}

export type DatasetSandboxRunCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function parseOptionalNumber(value?: string): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

function shouldLogDaytonaResources(): boolean {
  const explicit = parseOptionalBoolean(process.env.STRUCTURE_DAYTONA_LOG_RESOURCES)
  return explicit ?? false
}

function getDaytonaConfigFromEnv(): {
  apiUrl: string
  apiKey?: string
  jwtToken?: string
  organizationId?: string
  target?: string
} | null {
  const apiKey = String(process.env.DAYTONA_API_KEY ?? "").trim()
  const apiUrl =
    String(process.env.DAYTONA_API_URL ?? "").trim() ||
    String(process.env.DAYTONA_SERVER_URL ?? "").trim()
  const jwtToken = String(process.env.DAYTONA_JWT_TOKEN ?? "").trim()
  const organizationId = String(process.env.DAYTONA_ORGANIZATION_ID ?? "").trim()
  const target = String(process.env.DAYTONA_TARGET ?? "").trim()
  if (!apiUrl) return null
  if (!apiKey && !(jwtToken && organizationId)) return null
  return {
    apiUrl,
    apiKey: apiKey || undefined,
    jwtToken: jwtToken || undefined,
    organizationId: organizationId || undefined,
    target: target || undefined,
  }
}

async function logDaytonaResources(label: string): Promise<void> {
  if (!shouldLogDaytonaResources()) return
  const cfg = getDaytonaConfigFromEnv()
  if (!cfg) {
    console.log(`[daytona:${label}] missing Daytona env config`)
    return
  }
  try {
    const moduleName = "@daytonaio/sdk"
    const importer = new Function("m", "return import(m)") as (m: string) => Promise<any>
    const { Daytona } = (await importer(moduleName)) as any
    const daytona = new Daytona(cfg)
    const list = await daytona.list(undefined, 1, 50)
    const total = (list as any)?.total ?? (list as any)?.items?.length ?? 0
    console.log(`[daytona:${label}] sandboxes total=${total} page=${(list as any)?.page ?? 1}`)
    const items = Array.isArray((list as any)?.items) ? (list as any).items : []
    for (const sb of items.slice(0, 25)) {
      console.log(
        `[daytona:${label}] sandbox id=${sb?.id} state=${sb?.state} disk=${sb?.disk} cpu=${sb?.cpu} memory=${sb?.memory} autoDelete=${sb?.autoDeleteInterval} autoStop=${sb?.autoStopInterval} snapshot=${sb?.snapshot ?? ""} createdAt=${sb?.createdAt ?? ""}`,
      )
    }
    try {
      const volumes = await daytona.volume.list()
      const names = volumes.map((v: any) => v?.name).filter(Boolean)
      console.log(`[daytona:${label}] volumes count=${volumes.length} names=${names.slice(0, 20).join(",")}`)
    } catch (e) {
      console.log(`[daytona:${label}] volumes list error: ${e instanceof Error ? e.message : String(e)}`)
    }
  } catch (e) {
    console.log(`[daytona:${label}] list error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function getStructureDaytonaDefaults(): NonNullable<SandboxConfig["daytona"]> {
  const snapshot = String(process.env.STRUCTURE_DAYTONA_SNAPSHOT ?? "").trim()
  const image = String(process.env.STRUCTURE_DAYTONA_IMAGE ?? "").trim()
  const declarative = String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_IMAGE ?? "").trim()
  const ephemeralEnv = parseOptionalBoolean(process.env.STRUCTURE_DAYTONA_EPHEMERAL)
  const ephemeral = ephemeralEnv ?? true
  const autoStopIntervalMin = parseOptionalNumber(process.env.STRUCTURE_DAYTONA_AUTO_STOP_MIN)
  const autoArchiveIntervalMin = parseOptionalNumber(process.env.STRUCTURE_DAYTONA_AUTO_ARCHIVE_MIN)
  const autoDeleteIntervalMin = parseOptionalNumber(process.env.STRUCTURE_DAYTONA_AUTO_DELETE_MIN)
  const volumeName = getDaytonaVolumeName()
  const mountPath = getDaytonaVolumeMountPath()
  const volumes =
    volumeName && mountPath
      ? [
          {
            volumeName,
            mountPath,
          },
        ]
      : []

  return {
    snapshot: snapshot || undefined,
    image: image || (declarative ? "declarative" : undefined),
    ephemeral,
    autoStopIntervalMin,
    autoArchiveIntervalMin,
    autoDeleteIntervalMin,
    volumes,
  }
}

export async function createDatasetSandboxStep(
  params: { env: any } & CreateDatasetSandboxParams,
): Promise<{ sandboxId: DatasetSandboxId }> {
  "use step"
  const startedAt = Date.now()
  const { env, ...configInput } = params
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const db = (await getThreadRuntime(env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const daytonaDefaults = getStructureDaytonaDefaults()
  const explicitVolumes = configInput.daytona?.volumes
  const mergedDaytona: SandboxConfig["daytona"] = {
    ...daytonaDefaults,
    ...(configInput.daytona ?? {}),
    volumes: Array.isArray(explicitVolumes) ? explicitVolumes : daytonaDefaults.volumes,
  }
  const vcpusOverride = parseOptionalNumber(process.env.STRUCTURE_DAYTONA_VCPUS)
  const mergedResources = configInput.resources ?? (vcpusOverride ? { vcpus: vcpusOverride } : undefined)
  const config: SandboxConfig = {
    ...configInput,
    provider: "daytona",
    resources: mergedResources,
    daytona: mergedDaytona,
  }
  if (shouldLogDaytonaResources()) {
    console.log(
      `[daytona:create] config runtime=${config.runtime ?? ""} purpose=${config.purpose ?? ""} params=${JSON.stringify(
        config.params ?? {},
      )} snapshot=${config.daytona?.snapshot ?? ""} image=${config.daytona?.image ?? ""} ephemeral=${
        config.daytona?.ephemeral
      } autoStop=${config.daytona?.autoStopIntervalMin ?? ""} autoDelete=${config.daytona?.autoDeleteIntervalMin ?? ""} volumes=${JSON.stringify(
        config.daytona?.volumes ?? [],
      )}`,
    )
    console.log(`[daytona:create] ts=${new Date(startedAt).toISOString()} startMs=${startedAt}`)
  }
  await logDaytonaResources("before_create")
  const created = await service.createSandbox(config)
  if (!created.ok) {
    await logDaytonaResources("create_failed")
    throw new Error(created.error)
  }
  await logDaytonaResources("after_create")
  if (shouldLogDaytonaResources()) {
    const elapsedMs = Date.now() - startedAt
    console.log(`[daytona:create] doneMs=${Date.now()} elapsedMs=${elapsedMs}`)
  }
  if (shouldLogDaytonaResources()) {
    try {
      const info = await service.reconnectToSandbox(created.data.sandboxId)
      if (info.ok && !(info.data.sandbox as any).sandboxId) {
        const sb: any = info.data.sandbox
        console.log(
          `[daytona:after_create] sandbox id=${sb?.id} state=${sb?.state} disk=${sb?.disk} cpu=${sb?.cpu} memory=${sb?.memory} autoDelete=${sb?.autoDeleteInterval} autoStop=${sb?.autoStopInterval}`,
        )
      }
    } catch (e) {
      console.log(`[daytona:after_create] reconnect error: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const df = await service.runCommand(created.data.sandboxId, "df", ["-h"])
      if (df.ok) {
        console.log(`[sandbox:${created.data.sandboxId}] df -h\n${df.data.output}`)
      } else {
        console.log(`[sandbox:${created.data.sandboxId}] df error: ${df.error}`)
      }
    } catch (e) {
      console.log(`[sandbox:${created.data.sandboxId}] df error: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const mountPath = getDaytonaVolumeMountPath()
      const basePath = getDatasetWorkdirBase()
      const du = await service.runCommand(created.data.sandboxId, "du", ["-sh", mountPath, basePath])
      if (du.ok) {
        console.log(`[sandbox:${created.data.sandboxId}] du -sh\n${du.data.output}`)
      } else {
        console.log(`[sandbox:${created.data.sandboxId}] du error: ${du.error}`)
      }
    } catch (e) {
      console.log(`[sandbox:${created.data.sandboxId}] du error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { sandboxId: created.data.sandboxId }
}

export async function runDatasetSandboxCommandStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  cmd: string
  args?: string[]
}): Promise<DatasetSandboxRunCommandResult> {
  "use step"
  const startedAt = Date.now()
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.runCommand(params.sandboxId, params.cmd, params.args ?? [])
  if (!result.ok) throw new Error(result.error)
  const normalized = {
    exitCode: result.data.exitCode ?? (result.data.success ? 0 : 1),
    stdout: result.data.output ?? "",
    stderr: result.data.error ?? "",
  }
  if (shouldLogDaytonaResources()) {
    const elapsedMs = Date.now() - startedAt
    console.log(
      `[daytona:cmd] sandboxId=${params.sandboxId} cmd=${params.cmd} args=${JSON.stringify(
        params.args ?? [],
      )} elapsedMs=${elapsedMs}`,
    )
  }
  return normalized
}

export async function writeDatasetSandboxFilesStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  files: Array<{ path: string; contentBase64: string }>
}): Promise<void> {
  "use step"
  const startedAt = Date.now()
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.writeFiles(params.sandboxId, params.files)
  if (!result.ok) throw new Error(result.error)
  if (shouldLogDaytonaResources()) {
    const elapsedMs = Date.now() - startedAt
    console.log(
      `[daytona:write] sandboxId=${params.sandboxId} files=${params.files.length} elapsedMs=${elapsedMs}`,
    )
  }
}

/**
 * Workflow-safe helper:
 * Keep base64 encoding inside the step runtime (Node),
 * so the workflow runtime never needs `Buffer`.
 *
 * Input/Output are serializable.
 */
export async function writeDatasetSandboxTextFileStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  path: string
  text: string
}): Promise<void> {
  "use step"
  const contentBase64 = Buffer.from(String(params.text ?? ""), "utf-8").toString("base64")
  await writeDatasetSandboxFilesStep({
    env: params.env,
    sandboxId: params.sandboxId,
    files: [{ path: params.path, contentBase64 }],
  })
}

export async function readDatasetSandboxFileStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  path: string
}): Promise<{ contentBase64: string }> {
  "use step"
  const startedAt = Date.now()
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.readFile(params.sandboxId, params.path)
  if (!result.ok) throw new Error(result.error)
  if (shouldLogDaytonaResources()) {
    const elapsedMs = Date.now() - startedAt
    console.log(
      `[daytona:read] sandboxId=${params.sandboxId} path=${params.path} bytes=${result.data.contentBase64?.length ?? 0} elapsedMs=${elapsedMs}`,
    )
  }
  return result.data
}

/**
 * Workflow-safe helper:
 * Decode base64 -> utf-8 inside the step runtime (Node),
 * so the workflow runtime never needs `Buffer`.
 *
 * Input/Output are serializable.
 */
export async function readDatasetSandboxTextFileStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  path: string
}): Promise<{ text: string }> {
  "use step"
  const res = await readDatasetSandboxFileStep(params)
  const text = Buffer.from(res.contentBase64 ?? "", "base64").toString("utf-8")
  return { text }
}

export async function stopDatasetSandboxStep(params: { env: any; sandboxId: DatasetSandboxId }): Promise<void> {
  "use step"
  const startedAt = Date.now()
  const { getThreadRuntime } = await import("@ekairos/thread/runtime")
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.stopSandbox(params.sandboxId)
  if (!result.ok) throw new Error(result.error)
  if (shouldLogDaytonaResources()) {
    const elapsedMs = Date.now() - startedAt
    console.log(`[daytona:stop] sandboxId=${params.sandboxId} elapsedMs=${elapsedMs}`)
  }
}

