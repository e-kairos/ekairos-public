import { Sandbox } from "@vercel/sandbox"

export type VercelSandboxCreds = {
  teamId: string
  projectId: string
  token: string
}

export type SandboxRunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export function getVercelSandboxCredsFromEnv(): VercelSandboxCreds {
  const teamId = String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim()
  const projectId = String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim()
  const token = String(process.env.SANDBOX_VERCEL_TOKEN ?? "").trim()

  if (!teamId || !projectId || !token) {
    throw new Error(
      "Missing Vercel Sandbox env vars: SANDBOX_VERCEL_TEAM_ID, SANDBOX_VERCEL_PROJECT_ID, SANDBOX_VERCEL_TOKEN",
    )
  }

  return { teamId, projectId, token }
}

export function shQuote(value: string): string {
  // POSIX single-quote escaping
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

export async function createVercelSandbox(opts: {
  creds: VercelSandboxCreds
  timeoutMs: number
  runtime?: string
  vcpus?: number
}): Promise<Sandbox> {
  const { creds, timeoutMs } = opts
  return await Sandbox.create({
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
    runtime: (opts.runtime ?? "node22") as any,
    timeout: timeoutMs,
    ports: [],
    resources: { vcpus: opts.vcpus ?? 2 },
  } as any)
}

export async function runShInSandbox(sandbox: Sandbox, script: string): Promise<SandboxRunResult> {
  const res = await sandbox.runCommand("sh", ["-lc", script])
  const stdout = await (res.stdout as any)()
  const stderr = await (res.stderr as any)()
  return { exitCode: res.exitCode, stdout, stderr }
}

export async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk, "utf8"))
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
    else if (chunk instanceof ArrayBuffer) chunks.push(Buffer.from(chunk))
    else if (chunk) chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function stopSandboxBestEffort(sandbox: Sandbox) {
  try {
    await sandbox.stop()
  } catch {
    // ignore
  }
}

