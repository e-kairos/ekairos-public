import { Sandbox } from "@vercel/sandbox"

export type GitSource = {
  gitUrl: string
  accessToken: string
  branch?: string
}

export type CreateOrUpdateAppArgs = {
  /**
   * Si se pasa, se hace push schema+perms a esa app.
   * Si no se pasa, se crea una nueva app con instant-cli y luego se hace push.
   */
  appId?: string
  /**
   * Requerido si `appId` está definido (instant-cli push usa --token).
   * Si no hay `appId`, se obtiene desde instant-cli init-without-files.
   */
  adminToken?: string

  /**
   * Requerido si NO se pasa `appId` (para crear la app).
   */
  title?: string

  /**
   * Fuente git del repo a clonar/actualizar dentro del sandbox.
   * Si no se pasa, se resuelve desde envs de Vercel (VERCEL_GIT_*) o SANDBOX_GIT_*.
   */
  gitSource?: Partial<GitSource>

  /**
   * Reusar sandbox existente (útil para iterar muchos orgs sin recrear sandbox).
   */
  sandbox?: Sandbox

  /**
   * Directorio de trabajo dentro del sandbox.
   * Default: /tmp/app-repo
   */
  workdir?: string

  /**
   * Timeout para el sandbox temporal (ms).
   * Default: 20 minutos.
   */
  sandboxTimeoutMs?: number
}

export type CreateOrUpdateAppResult = {
  appId: string
  adminToken: string
  sandboxId: string
  repoDir: string
  logs: {
    clone?: string
    install?: string
    build?: string
    pushSchema?: string
    pushPerms?: string
  }
}

function requireEnv(name: string): string {
  const v = String(process.env[name] ?? "").trim()
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function getVercelSandboxCreds(): { teamId: string; projectId: string; token: string } {
  const teamId = String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim()
  const projectId = String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim()
  const token = String(process.env.SANDBOX_VERCEL_TOKEN ?? "").trim()

  if (!teamId || !projectId || !token) {
    throw new Error("Missing required Vercel sandbox env vars: SANDBOX_VERCEL_TEAM_ID, SANDBOX_VERCEL_PROJECT_ID, SANDBOX_VERCEL_TOKEN")
  }

  return { teamId, projectId, token }
}

async function createTemporarySandbox(opts: { timeoutMs: number }) {
  const creds = getVercelSandboxCreds()
  return await Sandbox.create({
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
    timeout: opts.timeoutMs,
    ports: [],
    runtime: "node22",
    resources: { vcpus: 2 },
  } as any)
}

function shSingleQuote(value: string): string {
  // Safest way to quote arbitrary strings in POSIX shell using single-quotes.
  // abc'def  =>  'abc'"'"'def'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function resolveGitUrlFromEnv(): string {
  const direct = String(process.env.SANDBOX_GIT_URL ?? "").trim()
  if (direct) return direct

  const owner = String(process.env.VERCEL_GIT_REPO_OWNER ?? "").trim()
  const slug = String(process.env.VERCEL_GIT_REPO_SLUG ?? "").trim()
  if (owner && slug) {
    return `https://github.com/${owner}/${slug}.git`
  }

  throw new Error(
    "Missing git URL. Provide gitSource.gitUrl or set SANDBOX_GIT_URL or VERCEL_GIT_REPO_OWNER/VERCEL_GIT_REPO_SLUG.",
  )
}

function resolveGitBranchFromEnv(): string {
  return (
    String(process.env.VERCEL_GIT_COMMIT_REF ?? "").trim() ||
    String(process.env.SANDBOX_GIT_BRANCH ?? "").trim() ||
    "main"
  )
}

function resolveGitAccessTokenFromEnv(): string {
  return (
    String(process.env.SANDBOX_GIT_ACCESS_TOKEN ?? "").trim() ||
    String(process.env.GITHUB_TOKEN ?? "").trim() ||
    String(process.env.GITHUB_API_KEY ?? "").trim()
  )
}

function toAuthedGitUrl(gitUrl: string, accessToken: string): string {
  // Supports https URLs. For GitHub, prefer x-access-token for org tokens.
  if (!gitUrl.startsWith("https://")) {
    throw new Error("gitUrl must be an https URL (for token-based cloning)")
  }

  const withoutProto = gitUrl.slice("https://".length)
  const isGithub = withoutProto.startsWith("github.com/") || withoutProto.includes("@github.com/")

  const tokenUser = isGithub ? "x-access-token" : "token"
  return `https://${encodeURIComponent(tokenUser)}:${encodeURIComponent(accessToken)}@${withoutProto}`
}

function parseInstantCliInitOutput(stdout: string): { appId: string; adminToken: string } {
  const raw = String(stdout ?? "").trim()

  // instant-cli prints JSON; we try to parse the last JSON object in the output.
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`instant-cli init output did not contain JSON. Got: ${raw.slice(0, 200)}`)
  }

  const jsonStr = raw.slice(firstBrace, lastBrace + 1)
  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    throw new Error(`Failed to parse instant-cli JSON. Got: ${jsonStr.slice(0, 200)}`)
  }

  if (parsed?.error) {
    throw new Error(`instant-cli error: ${String(parsed.error)}`)
  }

  const appId = String(parsed?.app?.appId ?? "")
  const adminToken = String(parsed?.app?.adminToken ?? "")
  if (!appId || !adminToken) {
    throw new Error("instant-cli did not return appId/adminToken")
  }

  return { appId, adminToken }
}

async function runSh(sandbox: Sandbox, script: string) {
  // Use -l to get corepack, etc. -e to fail fast.
  return await sandbox.runCommand("sh", ["-lc", script])
}

/**
 * Crea una app (instant-cli) + clona repo + pnpm install + pnpm build + push schema+perms.
 */
export async function createApp(args: Omit<CreateOrUpdateAppArgs, "appId" | "adminToken">): Promise<CreateOrUpdateAppResult> {
  return await createOrUpdateApp({ ...args, appId: undefined, adminToken: undefined })
}

/**
 * Clona/actualiza el repo, corre install/build, y hace push schema+perms.
 * - Si `appId` no existe, crea una app con instant-cli y retorna credenciales.
 * - Si `appId` existe, requiere `adminToken`.
 */
export async function createOrUpdateApp(args: CreateOrUpdateAppArgs): Promise<CreateOrUpdateAppResult> {
  const gitUrl = args.gitSource?.gitUrl?.trim() || resolveGitUrlFromEnv()
  const branch = args.gitSource?.branch?.trim() || resolveGitBranchFromEnv()
  const accessToken = args.gitSource?.accessToken?.trim() || resolveGitAccessTokenFromEnv()
  if (!accessToken) {
    throw new Error(
      "Missing git access token. Provide gitSource.accessToken or set SANDBOX_GIT_ACCESS_TOKEN/GITHUB_TOKEN/GITHUB_API_KEY.",
    )
  }

  const authedUrl = toAuthedGitUrl(gitUrl, accessToken)

  const instantCliAuthToken = requireEnv("INSTANT_CLI_AUTH_TOKEN")
  const repoDir = args.workdir?.trim() || "/tmp/app-repo"

  if (args.appId && !args.adminToken) {
    throw new Error("adminToken is required when appId is provided")
  }
  if (!args.appId && !args.title) {
    throw new Error("title is required when creating an app (appId not provided)")
  }

  let sandbox: Sandbox = args.sandbox ?? (await createTemporarySandbox({ timeoutMs: args.sandboxTimeoutMs ?? 20 * 60 * 1000 }))
  const sandboxId = String(sandbox.sandboxId)

  const logs: CreateOrUpdateAppResult["logs"] = {}

  // 1) Clone/update repo
  const cloneScript = [
    "set -euo pipefail",
    `REPO_DIR=${shSingleQuote(repoDir)}`,
    `BRANCH=${shSingleQuote(branch)}`,
    // Avoid leaking token in logs by NOT echoing URL; use a var.
    `AUTH_URL=${shSingleQuote(authedUrl)}`,
    "mkdir -p \"$REPO_DIR\"",
    "if [ -d \"$REPO_DIR/.git\" ]; then",
    "  cd \"$REPO_DIR\"",
    "  git remote set-url origin \"$AUTH_URL\"",
    "  git fetch --depth 1 origin \"$BRANCH\"",
    "  git checkout -B \"$BRANCH\" \"origin/$BRANCH\"",
    "  git reset --hard \"origin/$BRANCH\"",
    "else",
    "  rm -rf \"$REPO_DIR\"",
    "  git clone --depth 1 --branch \"$BRANCH\" \"$AUTH_URL\" \"$REPO_DIR\"",
    "fi",
    "cd \"$REPO_DIR\"",
    "git rev-parse --short HEAD",
  ].join("\n")

  const cloneRes = await runSh(sandbox, cloneScript)
  logs.clone = await cloneRes.stdout()

  // 2) Install deps (pnpm) + build
  const installScript = [
    "set -euo pipefail",
    `REPO_DIR=${shSingleQuote(repoDir)}`,
    "cd \"$REPO_DIR\"",
    "corepack enable",
    // Keep deterministic-ish: use project pnpm version if lockfile requires it; otherwise corepack default is fine.
    "pnpm --version",
    "pnpm install --frozen-lockfile",
  ].join("\n")
  const installRes = await runSh(sandbox, installScript)
  logs.install = await installRes.stdout()

  const buildScript = [
    "set -euo pipefail",
    `REPO_DIR=${shSingleQuote(repoDir)}`,
    "cd \"$REPO_DIR\"",
    "pnpm build",
  ].join("\n")
  const buildRes = await runSh(sandbox, buildScript)
  logs.build = await buildRes.stdout()

  // 3) Create app if needed
  let appId = args.appId
  let adminToken = args.adminToken

  if (!appId) {
    const initScript = [
      "set -euo pipefail",
      `REPO_DIR=${shSingleQuote(repoDir)}`,
      `INSTANT_CLI_AUTH_TOKEN=${shSingleQuote(instantCliAuthToken)}`,
      `TITLE=${shSingleQuote(String(args.title))}`,
      "export INSTANT_CLI_AUTH_TOKEN",
      "cd \"$REPO_DIR\"",
      "pnpm dlx instant-cli@latest init-without-files --title \"$TITLE\"",
    ].join("\n")
    const initRes = await runSh(sandbox, initScript)
    const initOut = await initRes.stdout()
    const created = parseInstantCliInitOutput(initOut)
    appId = created.appId
    adminToken = created.adminToken
  }

  // 4) Push schema + perms (uses --app/--token)
  const pushSchemaScript = [
    "set -euo pipefail",
    `REPO_DIR=${shSingleQuote(repoDir)}`,
    `INSTANT_CLI_AUTH_TOKEN=${shSingleQuote(instantCliAuthToken)}`,
    `APP_ID=${shSingleQuote(String(appId))}`,
    `ADMIN_TOKEN=${shSingleQuote(String(adminToken))}`,
    "export INSTANT_CLI_AUTH_TOKEN",
    "cd \"$REPO_DIR\"",
    "pnpm dlx instant-cli@latest push schema --app \"$APP_ID\" --token \"$ADMIN_TOKEN\" --yes",
  ].join("\n")
  const pushSchemaRes = await runSh(sandbox, pushSchemaScript)
  logs.pushSchema = await pushSchemaRes.stdout()

  const pushPermsScript = [
    "set -euo pipefail",
    `REPO_DIR=${shSingleQuote(repoDir)}`,
    `INSTANT_CLI_AUTH_TOKEN=${shSingleQuote(instantCliAuthToken)}`,
    `APP_ID=${shSingleQuote(String(appId))}`,
    `ADMIN_TOKEN=${shSingleQuote(String(adminToken))}`,
    "export INSTANT_CLI_AUTH_TOKEN",
    "cd \"$REPO_DIR\"",
    "pnpm dlx instant-cli@latest push perms --app \"$APP_ID\" --token \"$ADMIN_TOKEN\" --yes",
  ].join("\n")
  const pushPermsRes = await runSh(sandbox, pushPermsScript)
  logs.pushPerms = await pushPermsRes.stdout()

  return {
    appId: String(appId),
    adminToken: String(adminToken),
    sandboxId: String(sandboxId),
    repoDir,
    logs,
  }
}

