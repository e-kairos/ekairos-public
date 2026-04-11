#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline/promises"
import JSON5 from "json5"
import {
  clearCliSession,
  fetchDomainManifest,
  normalizeBaseUrl,
  postDomainAction,
  postDomainQuery,
  readCliSession,
  writeCliSession,
  ClientRuntime,
} from "./index.js"
import { createDomainApp } from "./create-app.js"

type CliContext = {
  stdout: Pick<typeof output, "write">
  stderr: Pick<typeof output, "write">
}

type CliSessionState = {
  baseUrl: string
  appId: string
  refreshToken: string
  apiURI: string
}

type CliAuthContext =
  | { mode: "admin" }
  | { mode: "guest" }
  | { mode: "email"; email: string }
  | { mode: "token"; refreshToken: string }

function printHelp(ctx: CliContext) {
  ctx.stdout.write(
    [
      "ekairos-domain",
      "",
      "Commands:",
      "  login <baseUrl> [--refreshToken=<token>] [--appId=<appId>]",
      "  create-app [dir] --next [--install] [--instantToken=<token>]",
      "  inspect [filter] [--baseUrl=<url>]",
      "  query <json5|@file|-> [--admin|--as-email <email>|--as-guest|--as-token <token>]",
      "  action <name> <json5|@file|-> [--env=<json5>] [--admin|--as-email <email>|--as-guest|--as-token <token>]",
      "  logout",
      "",
      "Input forms:",
      "  <json5>   Inline JSON5, e.g. { tasks: { comments: {} } }",
      "  @file     Read JSON5 from a file",
      "  -         Read JSON5 from stdin",
      "",
      "Shorthand:",
      "  ekairos-domain <actionKey> <json5|@file|-> [--env=<json5>]",
      "",
      "Output:",
      "  Stable JSON by default. Add --pretty for indented JSON.",
      "",
      "Scaffold flags:",
      "  --workspace <path>  Use the local workspace package instead of a published version",
      "  --instantToken      Provision an Instant app and write .env.local",
      "  --appId/--adminToken  Reuse an existing Instant app",
      "",
    ].join("\n"),
  )
}

function parseFlags(argv: string[]) {
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1))
      break
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const raw = arg.slice(2)
    if (!raw) continue

    if (raw.startsWith("no-") && raw.length > 3) {
      flags.set(raw.slice(3), false)
      continue
    }

    const separator = raw.indexOf("=")
    if (separator >= 0) {
      const name = raw.slice(0, separator)
      const value = raw.slice(separator + 1)
      flags.set(name, value)
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(raw, next)
      index += 1
      continue
    }

    flags.set(raw, true)
  }

  return { positionals, flags }
}

function flagValue(flags: Map<string, string | boolean>, names: string[]) {
  for (const name of names) {
    if (flags.has(name)) return flags.get(name)
  }
  return undefined
}

function hasFlag(flags: Map<string, string | boolean>, names: string[]) {
  const value = flagValue(flags, names)
  return value === true || value === "true"
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function promptRefreshToken(): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    const value = await rl.question("Instant refresh token: ")
    return String(value ?? "").trim()
  } finally {
    rl.close()
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry))
  }
  if (!value || typeof value !== "object") {
    return value
  }

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key])
  }
  return sorted
}

function toJsonText(value: unknown, flags?: Map<string, string | boolean>) {
  const pretty = hasFlag(flags ?? new Map(), ["pretty"])
  const normalized = sortJsonValue(value)
  return `${JSON.stringify(normalized, null, pretty ? 2 : 0)}\n`
}

function writeJson(
  stream: Pick<typeof output, "write">,
  value: unknown,
  flags?: Map<string, string | boolean>,
) {
  stream.write(toJsonText(value, flags))
}

async function readStdinText() {
  let data = ""
  for await (const chunk of input) {
    data += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
  }
  return data
}

async function readInputText(raw: string | undefined) {
  const source = String(raw ?? "").trim()
  if (!source || source === "-") {
    if (input.isTTY) return ""
    return await readStdinText()
  }
  if (source.startsWith("@")) {
    const filePath = source.slice(1).trim()
    if (!filePath) {
      throw new Error("input file path is required after @")
    }
    return await readFile(filePath, "utf8")
  }
  return source
}

async function parseJsonInput(raw: string | undefined, label: string) {
  const text = String(await readInputText(raw)).trim()
  if (!text) return {}
  try {
    return JSON5.parse(text)
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON5: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function resolveSession(
  flags: Map<string, string | boolean>,
): Promise<CliSessionState> {
  const stored = await readCliSession()
  const baseUrlFlag = flagValue(flags, ["baseUrl", "base-url"])
  const appIdFlag = flagValue(flags, ["appId", "app-id"])
  const refreshTokenFlag = flagValue(flags, ["refreshToken", "refresh-token"])
  const apiURIFlag = flagValue(flags, ["apiURI", "api-uri"])

  const baseUrl =
    asTrimmedString(baseUrlFlag) ||
    asTrimmedString(process.env.EKAIROS_DOMAIN_BASE_URL) ||
    asTrimmedString(stored?.baseUrl)

  return {
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : "",
    appId:
      asTrimmedString(appIdFlag) ||
      asTrimmedString(process.env.EKAIROS_DOMAIN_APP_ID) ||
      asTrimmedString(stored?.appId),
    refreshToken:
      asTrimmedString(refreshTokenFlag) ||
      asTrimmedString(process.env.EKAIROS_REFRESH_TOKEN) ||
      asTrimmedString(stored?.refreshToken),
    apiURI:
      asTrimmedString(apiURIFlag) ||
      asTrimmedString(process.env.EKAIROS_DOMAIN_API_URI) ||
      asTrimmedString(stored?.apiURI) ||
      "https://api.instantdb.com",
  }
}

function resolveAuthContext(
  flags: Map<string, string | boolean>,
  session: CliSessionState,
): CliAuthContext {
  const asEmail = asTrimmedString(flagValue(flags, ["as-email", "asEmail"]))
  const asToken =
    asTrimmedString(flagValue(flags, ["as-token", "asToken"])) || session.refreshToken
  const asGuest = hasFlag(flags, ["as-guest", "asGuest"])
  const admin = hasFlag(flags, ["admin"])

  const explicitContexts = [
    admin ? "admin" : null,
    asEmail ? "email" : null,
    asGuest ? "guest" : null,
    asTrimmedString(flagValue(flags, ["as-token", "asToken"])) ? "token" : null,
  ].filter(Boolean)

  if (explicitContexts.length > 1) {
    throw new Error(
      "Please specify exactly one context: --admin, --as-email <email>, --as-guest, or --as-token <token>",
    )
  }

  if (admin) return { mode: "admin" }
  if (asEmail) return { mode: "email", email: asEmail }
  if (asGuest) return { mode: "guest" }
  if (asToken) return { mode: "token", refreshToken: asToken }
  return { mode: "admin" }
}

async function commandLogin(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const baseUrl = normalizeBaseUrl(positionals[0] ?? "")
  let refreshToken =
    asTrimmedString(flagValue(flags, ["refreshToken", "refresh-token"])) ||
    asTrimmedString(flagValue(flags, ["as-token", "asToken"])) ||
    asTrimmedString(process.env.EKAIROS_REFRESH_TOKEN)

  if (!refreshToken) {
    refreshToken = await promptRefreshToken()
  }
  if (!refreshToken) {
    throw new Error("refreshToken is required")
  }

  const manifest = await fetchDomainManifest({ baseUrl, refreshToken })
  const appId =
    asTrimmedString(flagValue(flags, ["appId", "app-id"])) ||
    asTrimmedString(manifest.instant.appId)
  if (!appId) {
    throw new Error("appId is required. Pass --appId=... or expose it from the domain endpoint.")
  }

  const runtime = new ClientRuntime({
    appId,
    refreshToken,
    apiURI: asTrimmedString(manifest.instant.apiURI) || "https://api.instantdb.com",
  })
  const user = await runtime.verify()

  await writeCliSession({
    version: 1,
    baseUrl,
    appId,
    refreshToken,
    apiURI: runtime.apiURI,
    savedAt: new Date().toISOString(),
  })

  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "login",
      data: {
        actions: manifest.actions.map((action) => action.key || action.name),
        actor: {
          email: user.email ?? null,
          id: user.id,
          isGuest: user.isGuest,
        },
        appId,
        baseUrl,
        entities: Array.isArray((manifest.domain as any)?.entities)
          ? (manifest.domain as any).entities.length
          : null,
      },
    },
    flags,
  )
}

async function commandInspect(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.baseUrl) {
    throw new Error("baseUrl is required. Run login first or pass --baseUrl=<url>.")
  }

  const auth = resolveAuthContext(flags, session)
  const manifest = await fetchDomainManifest({
    baseUrl: session.baseUrl,
    refreshToken: auth.mode === "token" ? auth.refreshToken : undefined,
  })
  const filter = String(positionals[0] ?? "").trim().toLowerCase()
  const actions = manifest.actions.filter((action) => {
    if (!filter) return true
    return (
      String(action.name ?? "").toLowerCase().includes(filter) ||
      String(action.key ?? "").toLowerCase().includes(filter)
    )
  })

  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "inspect",
      data: {
        actions,
        appId: manifest.instant.appId ?? session.appId,
        auth: manifest.auth,
        baseUrl: session.baseUrl,
        contextString: manifest.contextString ?? null,
        entities: (manifest.domain as any)?.entities ?? [],
        links: (manifest.domain as any)?.links ?? [],
        rooms: (manifest.domain as any)?.rooms ?? [],
      },
    },
    flags,
  )
}

async function commandCreateApp(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  if (!hasFlag(flags, ["next"])) {
    throw new Error("create-app currently requires --next")
  }

  const directory = String(positionals[0] ?? ".").trim() || "."
  const install = flagValue(flags, ["install"]) !== false

  const result = await createDomainApp({
    directory,
    framework: "next",
    install,
    force: hasFlag(flags, ["force"]),
    packageManager: asTrimmedString(flagValue(flags, ["packageManager", "package-manager"])),
    workspacePath: asTrimmedString(flagValue(flags, ["workspace"])),
    instantToken:
      asTrimmedString(flagValue(flags, ["instantToken", "instant-token"])) ||
      asTrimmedString(process.env.INSTANT_PERSONAL_ACCESS_TOKEN) ||
      asTrimmedString(process.env.INSTANTDB_PERSONAL_ACCESS_TOKEN) ||
      asTrimmedString(process.env.INSTANT_PLATFORM_ACCESS_TOKEN),
    orgId: asTrimmedString(flagValue(flags, ["orgId", "org-id"])),
    appId: asTrimmedString(flagValue(flags, ["appId", "app-id"])),
    adminToken: asTrimmedString(flagValue(flags, ["adminToken", "admin-token"])),
  })

  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "create-app",
      data: result,
    },
    flags,
  )
}

async function commandQuery(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.baseUrl) {
    throw new Error("baseUrl is required. Run login first or pass --baseUrl=<url>.")
  }

  const query = (await parseJsonInput(positionals[0], "query")) as Record<string, unknown>
  const envFlag = flagValue(flags, ["env"])
  const env =
    typeof envFlag === "string" && envFlag.trim()
      ? (await parseJsonInput(envFlag, "env")) as Record<string, unknown>
      : undefined

  const auth = resolveAuthContext(flags, session)
  const envelope = hasFlag(flags, ["envelope", "meta"])
  const preferServer = auth.mode !== "token" || hasFlag(flags, ["remote"])

  if (!preferServer && session.appId) {
    const manifest = await fetchDomainManifest({
      baseUrl: session.baseUrl,
      refreshToken: auth.refreshToken,
    })
    const runtime = new ClientRuntime({
      appId: session.appId,
      refreshToken: auth.refreshToken,
      apiURI: session.apiURI,
    })
    const result = await runtime.query(query, manifest.schema)
    const data =
      result && typeof result === "object" && "data" in (result as any)
        ? (result as any).data
        : result

    writeJson(
      ctx.stdout,
      envelope ? { ok: true, source: "client", data } : data,
      flags,
    )
    return
  }

  const result = await postDomainQuery({
    baseUrl: session.baseUrl,
    appId: session.appId || undefined,
    refreshToken: auth.mode === "token" ? auth.refreshToken : undefined,
    query,
    env,
    admin: auth.mode === "admin",
    asEmail: auth.mode === "email" ? auth.email : undefined,
    asGuest: auth.mode === "guest",
  })
  if (!result.ok) {
    throw new Error(result.error || "domain_query_failed")
  }

  writeJson(
    ctx.stdout,
    envelope
      ? {
          ok: true,
          source: "server",
          data: result.data ?? {},
          truncated: result.truncated ?? null,
        }
      : (result.data ?? {}),
    flags,
  )
}

async function commandAction(actionName: string, args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.baseUrl) {
    throw new Error("baseUrl is required. Run login first or pass --baseUrl=<url>.")
  }

  const inputValue = await parseJsonInput(positionals[0], "action input")
  const envFlag = flagValue(flags, ["env"])
  const env =
    typeof envFlag === "string" && envFlag.trim()
      ? (await parseJsonInput(envFlag, "env")) as Record<string, unknown>
      : undefined

  const auth = resolveAuthContext(flags, session)
  const manifest = await fetchDomainManifest({
    baseUrl: session.baseUrl,
    refreshToken: auth.mode === "token" ? auth.refreshToken : undefined,
  })

  const resolvedActionName =
    manifest.actions.find(
      (entry) => entry.name === actionName || String(entry.key ?? "") === actionName,
    )?.name ?? actionName

  const result = await postDomainAction({
    baseUrl: session.baseUrl,
    appId: session.appId || undefined,
    refreshToken: auth.mode === "token" ? auth.refreshToken : undefined,
    action: resolvedActionName,
    input: inputValue,
    env,
    admin: auth.mode === "admin",
    asEmail: auth.mode === "email" ? auth.email : undefined,
    asGuest: auth.mode === "guest",
  })

  if (!result.ok) {
    throw new Error(result.error || "domain_action_failed")
  }

  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "action",
      data: result,
    },
    flags,
  )
}

async function commandLogout(args: string[], ctx: CliContext) {
  const { flags } = parseFlags(args)
  await clearCliSession()
  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "logout",
      data: { cleared: true },
    },
    flags,
  )
}

export async function runCli(
  argv: string[],
  ctx: CliContext = { stdout: output, stderr: output },
) {
  const [command, ...rest] = argv

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp(ctx)
      return 0
    }

    if (command === "login") {
      await commandLogin(rest, ctx)
      return 0
    }
    if (command === "inspect") {
      await commandInspect(rest, ctx)
      return 0
    }
    if (command === "create-app") {
      await commandCreateApp(rest, ctx)
      return 0
    }
    if (command === "query") {
      await commandQuery(rest, ctx)
      return 0
    }
    if (command === "action") {
      const [actionName, ...args] = rest
      if (!actionName) throw new Error("action name is required")
      await commandAction(actionName, args, ctx)
      return 0
    }
    if (command === "logout") {
      await commandLogout(rest, ctx)
      return 0
    }

    await commandAction(command, rest, ctx)
    return 0
  } catch (error) {
    writeJson(
      ctx.stderr,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      new Map(),
    )
    return 1
  }
}

const isDirectExecution = (() => {
  const current = process.argv[1] ?? ""
  return current.endsWith("bin.js") || current.endsWith("bin.ts")
})()

if (isDirectExecution) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
