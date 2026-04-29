import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { SandboxService } from "@ekairos/sandbox"

const execFileAsync = promisify(execFile)
const localSandboxRoots = new Map<string, string>()

export type DatasetSandboxId = string

export type CreateDatasetSandboxParams = {
  sandboxRuntime?: string
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

function isLocalDatasetSandboxMode() {
  return String(process.env.DATASET_TEST_LOCAL_SANDBOX ?? "").trim() === "1"
}

async function getRuntimeDb(runtime: any) {
  if (!runtime) {
    throw new Error("Dataset sandbox step requires runtime.")
  }

  const db = runtime.db
  return typeof db === "function" ? await db.call(runtime) : db
}

function getLocalSandboxRoot(sandboxId: string) {
  return (
    localSandboxRoots.get(sandboxId) ||
    path.resolve(process.cwd(), "test-results", "dataset-sandboxes", sandboxId)
  )
}

async function ensureLocalSandboxRoot(sandboxId: string) {
  const root = getLocalSandboxRoot(sandboxId)
  await fs.mkdir(root, { recursive: true })
  localSandboxRoots.set(sandboxId, root)
  return root
}

async function runLocalSandboxCommand(params: {
  sandboxId: DatasetSandboxId
  cmd: string
  args?: string[]
}): Promise<DatasetSandboxRunCommandResult> {
  const root = await ensureLocalSandboxRoot(params.sandboxId)
  const cmd = String(params.cmd ?? "").trim()
  const args = params.args ?? []

  if (cmd === "mkdir") {
    const target = args[args.length - 1]
    await fs.mkdir(String(target ?? ""), { recursive: true })
    return { exitCode: 0, stdout: "", stderr: "" }
  }

  if (cmd === "rm") {
    const target = args[args.length - 1]
    await fs.rm(String(target ?? ""), { force: true, recursive: false })
    return { exitCode: 0, stdout: "", stderr: "" }
  }

  if (cmd === "test" && args[0] === "-f") {
    try {
      await fs.access(String(args[1] ?? ""))
      return { exitCode: 0, stdout: "", stderr: "" }
    } catch {
      return { exitCode: 1, stdout: "", stderr: "" }
    }
  }

  const result = await execFileAsync(cmd, args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  }).catch((error: any) => ({
    stdout: String(error?.stdout ?? ""),
    stderr: String(error?.stderr ?? error?.message ?? ""),
    exitCode: Number(error?.code ?? 1),
  }))

  return {
    exitCode: Number((result as any).exitCode ?? 0),
    stdout: String((result as any).stdout ?? ""),
    stderr: String((result as any).stderr ?? ""),
  }
}

export async function createDatasetSandboxStep(
  params: { runtime: any } & CreateDatasetSandboxParams,
): Promise<{ sandboxId: DatasetSandboxId }> {
  "use step"

  if (isLocalDatasetSandboxMode()) {
    const sandboxId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    await ensureLocalSandboxRoot(sandboxId)
    return { sandboxId }
  }

  const db = await getRuntimeDb(params.runtime)
  const service = new SandboxService(db)
  const sandboxParams = { ...params, runtime: params.sandboxRuntime } as any
  delete sandboxParams.sandboxRuntime
  const created = await service.createSandbox(sandboxParams)
  if (!created.ok) throw new Error(created.error)
  return { sandboxId: created.data.sandboxId }
}

export async function runDatasetSandboxCommandStep(params: {
  runtime: any
  sandboxId: DatasetSandboxId
  cmd: string
  args?: string[]
}): Promise<DatasetSandboxRunCommandResult> {
  "use step"

  if (isLocalDatasetSandboxMode()) {
    return await runLocalSandboxCommand({
      sandboxId: params.sandboxId,
      cmd: params.cmd,
      args: params.args,
    })
  }

  const db = await getRuntimeDb(params.runtime)
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
  runtime: any
  sandboxId: DatasetSandboxId
  files: Array<{ path: string; contentBase64: string }>
}): Promise<void> {
  "use step"

  if (isLocalDatasetSandboxMode()) {
    for (const file of params.files) {
      await fs.mkdir(path.dirname(file.path), { recursive: true })
      await fs.writeFile(file.path, Buffer.from(file.contentBase64, "base64"))
    }
    return
  }

  const db = await getRuntimeDb(params.runtime)
  const service = new SandboxService(db)
  const result = await service.writeFiles(params.sandboxId, params.files)
  if (!result.ok) throw new Error(result.error)
}

export async function readDatasetSandboxFileStep(params: {
  runtime: any
  sandboxId: DatasetSandboxId
  path: string
}): Promise<{ contentBase64: string }> {
  "use step"

  if (isLocalDatasetSandboxMode()) {
    const content = await fs.readFile(params.path)
    return { contentBase64: Buffer.from(content).toString("base64") }
  }

  const db = await getRuntimeDb(params.runtime)
  const service = new SandboxService(db)
  const result = await service.readFile(params.sandboxId, params.path)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export async function stopDatasetSandboxStep(params: { runtime: any; sandboxId: DatasetSandboxId }): Promise<void> {
  "use step"

  if (isLocalDatasetSandboxMode()) {
    const root = getLocalSandboxRoot(params.sandboxId)
    await fs.rm(root, { recursive: true, force: true })
    localSandboxRoots.delete(params.sandboxId)
    return
  }

  const db = await getRuntimeDb(params.runtime)
  const service = new SandboxService(db)
  const result = await service.stopSandbox(params.sandboxId)
  if (!result.ok) throw new Error(result.error)
}
