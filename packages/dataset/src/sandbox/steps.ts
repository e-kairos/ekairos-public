import { getThreadRuntime } from "@ekairos/thread/runtime"

export type DatasetSandboxId = string

export type CreateDatasetSandboxParams = {
  runtime?: string
  timeoutMs?: number
  ports?: number[]
  resources?: { vcpus?: number }
  purpose?: string
  params?: Record<string, any>
}

export type DatasetSandboxRunCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export async function createDatasetSandboxStep(
  params: { env: any } & CreateDatasetSandboxParams,
): Promise<{ sandboxId: DatasetSandboxId }> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const created = await service.createSandbox(params)
  if (!created.ok) throw new Error(created.error)
  return { sandboxId: created.data.sandboxId }
}

export async function runDatasetSandboxCommandStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  cmd: string
  args?: string[]
}): Promise<DatasetSandboxRunCommandResult> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.runCommand(params.sandboxId, params.cmd, params.args ?? [])
  if (!result.ok) throw new Error(result.error)
  return {
    exitCode: result.data.exitCode ?? (result.data.success ? 0 : 1),
    stdout: result.data.output ?? "",
    stderr: result.data.error ?? "",
  }
}

export async function writeDatasetSandboxFilesStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  files: Array<{ path: string; contentBase64: string }>
}): Promise<void> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.writeFiles(params.sandboxId, params.files)
  if (!result.ok) throw new Error(result.error)
}

export async function readDatasetSandboxFileStep(params: {
  env: any
  sandboxId: DatasetSandboxId
  path: string
}): Promise<{ contentBase64: string }> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.readFile(params.sandboxId, params.path)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export async function stopDatasetSandboxStep(params: { env: any; sandboxId: DatasetSandboxId }): Promise<void> {
  "use step"
  const db = (await getThreadRuntime(params.env) as any).db
  const { SandboxService } = (await import("@ekairos/sandbox")) as any
  const service = new SandboxService(db)
  const result = await service.stopSandbox(params.sandboxId)
  if (!result.ok) throw new Error(result.error)
}

