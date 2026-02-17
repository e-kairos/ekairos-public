import { createRequire } from "node:module"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

export type NextConfigLike = {
  webpack?: ((config: any, options: any) => any) | null
  turbopack?: any
}

type WithRuntimeOptions = {
  /**
   * Module that registers the runtime resolver (usually `./src/runtime.ts`).
   *
   * This module should be **runtime-only** (server) and should only register factories/config,
   * not create network/db clients eagerly.
   */
  bootstrapModule?: string
}

type NextConfigFnLike = (phase: string, ctx: any) => Promise<any> | any

function patchWorkflowStepRouteToImportBootstrap(bootstrapModule: string) {
  const cwd = process.cwd()
  const candidates = [
    // legacy app-dir without /src
    resolve(cwd, "app/.well-known/workflow/v1/step/route.js"),
    resolve(cwd, "app/.well-known/workflow/v1/step/route.ts"),
    // app-dir under /src
    resolve(cwd, "src/app/.well-known/workflow/v1/step/route.js"),
    resolve(cwd, "src/app/.well-known/workflow/v1/step/route.ts"),
  ]

  const bootstrapAbs = resolve(cwd, bootstrapModule)

  for (const routeFile of candidates) {
    let contents: string
    try {
      contents = readFileSync(routeFile, "utf8")
    } catch {
      continue
    }

    const routeDir = dirname(routeFile)
    let spec = relative(routeDir, bootstrapAbs).replace(/\\/g, "/")
    if (!spec.startsWith(".")) spec = `./${spec}`

    const importLine = `import * as __ekairosBootstrap from "${spec}";`
    const touchLine = `__ekairosBootstrap?.runtimeConfig?.setup?.();`
    const hasImport = contents.includes(importLine)
    const hasTouch = contents.includes(touchLine)
    if (hasImport && hasTouch) continue

    const lines = contents.split(/\r?\n/)

    // Insert the import above the first real statement (skip comments/empty lines).
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim()
      const isComment =
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*") ||
        t.startsWith("*/")
      if (t === "" || isComment) continue
      insertAt = i
      break
    }

    if (!hasImport) {
      lines.splice(insertAt, 0, importLine)
    }

    if (!hasTouch) {
      let lastImport = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith("import ")) lastImport = i
      }
      const touchAt = lastImport >= 0 ? lastImport + 1 : insertAt + 1
      lines.splice(touchAt, 0, touchLine)
    }
    writeFileSync(routeFile, lines.join("\n"))
  }
}

function resolveAppDir(cwd: string): string {
  const srcAppDir = resolve(cwd, "src/app")
  if (existsSync(srcAppDir)) return srcAppDir
  const appDir = resolve(cwd, "app")
  if (existsSync(appDir)) return appDir
  const srcDir = resolve(cwd, "src")
  if (existsSync(srcDir)) return resolve(srcDir, "app")
  return appDir
}

const generatedDomainRoutes = new Set<string>()
const domainRouteMarker = "@ekairos/domain-route"

function ensureDomainRouteFile(bootstrapModule: string) {
  const cwd = process.cwd()
  const appDir = resolveAppDir(cwd)

  const routeDir = resolve(appDir, ".well-known/ekairos/v1/domain")
  const routeTs = resolve(routeDir, "route.ts")
  const routeJs = resolve(routeDir, "route.js")
  if (existsSync(routeTs)) rmSync(routeTs, { force: true })
  if (existsSync(routeJs)) rmSync(routeJs, { force: true })

  const ext = existsSync(resolve(cwd, "tsconfig.json")) ? "ts" : "js"
  const routeFile = resolve(routeDir, `route.${ext}`)

  const bootstrapAbs = resolve(cwd, bootstrapModule)
  let spec = relative(routeDir, bootstrapAbs).replace(/\\/g, "/")
  if (!spec.startsWith(".")) spec = `./${spec}`

  mkdirSync(routeDir, { recursive: true })

  const contents = [
    `// ${domainRouteMarker}`,
    `import * as __ekairosBootstrap from "${spec}"`,
    `__ekairosBootstrap?.runtimeConfig?.setup?.()`,
    `import { NextResponse } from "next/server"`,
    `import { getRuntimeConfig, resolveRuntime } from "@ekairos/domain/runtime"`,
    `import { verifyOidcToken } from "@ekairos/thread/oidc"`,
    ``,
    `function listKeys(value) {`,
    `  return value ? Object.keys(value) : []`,
    `}`,
    ``,
    `function resolveSource(config) {`,
    `  return config?.domain ?? null`,
    `}`,
    ``,
    `function buildSchema(source) {`,
    `  if (!source) return null`,
    `  if (typeof source.toInstantSchema === "function") return source.toInstantSchema()`,
    `  if (typeof source.schema === "function") return source.schema()`,
    `  return {`,
    `    entities: source.entities ?? {},`,
    `    links: source.links ?? {},`,
    `    rooms: source.rooms ?? {},`,
    `  }`,
    `}`,
    ``,
    `function buildSummary(config, source) {`,
    `  return {`,
    `    available: Boolean(source),`,
    `    entities: listKeys(source?.entities),`,
    `    links: listKeys(source?.links),`,
    `    rooms: listKeys(source?.rooms),`,
    `    meta: config?.meta ?? {},`,
    `  }`,
    `}`,
    ``,
    `function buildContext(config, source) {`,
    `  if (!source || typeof source.context !== "function") return null`,
    `  return source.context({`,
    `    meta: config?.meta,`,
    `  })`,
    `}`,
    ``,
    `function buildContextString(config, source) {`,
    `  if (!source || typeof source.contextString !== "function") return null`,
    `  return source.contextString({`,
    `    meta: config?.meta,`,
    `  })`,
    `}`,
    ``,
    `const DEFAULT_OIDC_JWKS = "https://oidc.vercel.com/.well-known/jwks.json"`,
    `const DEFAULT_OIDC_ISSUER = "https://oidc.vercel.com"`,
    ``,
    `function parseOptionalBoolean(value) {`,
    `  const normalized = String(value ?? "").trim().toLowerCase()`,
    `  if (!normalized) return undefined`,
    `  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true`,
    `  if (["0", "false", "no", "n", "off"].includes(normalized)) return false`,
    `  return undefined`,
    `}`,
    ``,
    `function resolveBearerToken(req) {`,
    `  const header = req.headers.get("authorization") || ""`,
    `  if (!header.startsWith("Bearer ")) return null`,
    `  return header.slice("Bearer ".length).trim()`,
    `}`,
    ``,
    `function resolveOidcJwksUrl() {`,
    `  return String(process.env.EKAIROS_DOMAIN_JWKS_URL ?? "").trim() || DEFAULT_OIDC_JWKS`,
    `}`,
    ``,
    `function resolveOidcIssuer() {`,
    `  return String(process.env.EKAIROS_DOMAIN_ISSUER ?? "").trim() || DEFAULT_OIDC_ISSUER`,
    `}`,
    ``,
    `function resolveOidcAudience() {`,
    `  const explicit = String(process.env.EKAIROS_DOMAIN_AUDIENCE ?? "").trim()`,
    `  return explicit || null`,
    `}`,
    ``,
    `function isAuthRequired() {`,
    `  const explicit = parseOptionalBoolean(process.env.EKAIROS_DOMAIN_AUTH_REQUIRED)`,
    `  if (explicit !== undefined) return explicit`,
    `  return Boolean(`,
    `    process.env.EKAIROS_DOMAIN_TOKEN ||`,
    `      process.env.EKAIROS_DOMAIN_JWKS_URL ||`,
    `      process.env.EKAIROS_DOMAIN_ISSUER ||`,
    `      process.env.EKAIROS_DOMAIN_AUDIENCE`,
    `  )`,
    `}`,
    ``,
    `async function isAuthorized(req) {`,
    `  if (!isAuthRequired()) return true`,
    `  const token = resolveBearerToken(req)`,
    `  if (!token) return false`,
    `  const staticToken = process.env.EKAIROS_DOMAIN_TOKEN`,
    `  if (staticToken && token === staticToken) return true`,
    `  try {`,
    `    return await verifyOidcToken(token, {`,
    `      jwksUrl: resolveOidcJwksUrl(),`,
    `      issuer: resolveOidcIssuer(),`,
    `      audience: resolveOidcAudience(),`,
    `    })`,
    `  } catch {`,
    `    return false`,
    `  }`,
    `}`,
    ``,
    `export async function GET(req) {`,
    `  if (!(await isAuthorized(req))) {`,
    `    return new NextResponse("Unauthorized", { status: 401 })`,
    `  }`,
    `  const config = getRuntimeConfig()`,
    `  const source = resolveSource(config)`,
    `  const context = buildContext(config, source)`,
    `  const schema = context?.schema ?? buildSchema(source)`,
    `  const contextString = buildContextString(config, source)`,
    `  return NextResponse.json({`,
    `    mode: "full",`,
    `    domain: context ?? buildSummary(config, source),`,
    `    schema,`,
    `    contextString,`,
    `  })`,
    `}`,
    ``,
    `function truncateQueryResult(result) {`,
    `  const MAX_QUERY_ROWS = 50`,
    `  const output = {}`,
    `  const truncation = {}`,
    ``,
    `  for (const [key, value] of Object.entries(result ?? {})) {`,
    `    if (Array.isArray(value)) {`,
    `      const total = value.length`,
    `      const returned = Math.min(total, MAX_QUERY_ROWS)`,
    `      output[key] = value.slice(0, returned)`,
    `      if (total > returned) {`,
    `        truncation[key] = { returned, total }`,
    `      }`,
    `      continue`,
    `    }`,
    `    output[key] = value`,
    `  }`,
    ``,
    `  return {`,
    `    data: output,`,
    `    truncated: Object.keys(truncation).length > 0 ? truncation : null,`,
    `  }`,
    `}`,
    ``,
    `export async function POST(req) {`,
    `  if (!(await isAuthorized(req))) {`,
    `    return new NextResponse("Unauthorized", { status: 401 })`,
    `  }`,
    `  let body = null`,
    `  try {`,
    `    body = await req.json()`,
    `  } catch {`,
    `    body = null`,
    `  }`,
    ``,
    `  const orgId = String(body?.orgId ?? "").trim()`,
    `  const query = body?.query ?? null`,
    ``,
    `  if (!orgId || !query) {`,
    `    return new NextResponse("Missing orgId or query", { status: 400 })`,
    `  }`,
    ``,
    `  const config = getRuntimeConfig()`,
    `  const source = resolveSource(config)`,
    `  if (!source) {`,
    `    return new NextResponse("Runtime domain not configured", { status: 500 })`,
    `  }`,
    `  const runtime = await resolveRuntime(source, { orgId })`,
    `  const result = await runtime.db.query(query)`,
    `  return NextResponse.json({`,
    `    ok: true,`,
    `    ...truncateQueryResult(result),`,
    `  })`,
    `}`,
    ``,
  ].join("\n")

  writeFileSync(routeFile, contents)
  generatedDomainRoutes.add(routeFile)
}

function injectBootstrapIntoEntries(entries: Record<string, any>, bootstrap: string) {
  for (const key of Object.keys(entries)) {
    const entry = entries[key]

    // Webpack 5 "EntryDescription" form
    if (entry && typeof entry === "object" && !Array.isArray(entry) && "import" in entry) {
      const imports = entry.import
      if (Array.isArray(imports)) {
        if (!imports.includes(bootstrap)) entry.import = [bootstrap, ...imports]
      } else if (typeof imports === "string") {
        if (imports !== bootstrap) entry.import = [bootstrap, imports]
      }
      continue
    }

    if (Array.isArray(entry)) {
      if (!entry.includes(bootstrap)) entries[key] = [bootstrap, ...entry]
      continue
    }

    if (typeof entry === "string") {
      if (entry !== bootstrap) entries[key] = [bootstrap, entry]
    }
  }
}

/**
 * Next.js helper to ensure the runtime bootstrap is registered in *every* server bundle.
 *
 * This is the most explicit & DX-friendly option:
 * - No per-route/workflow imports
 * - No "magic" root bootstrap file
 * - Works for step runtimes because the server entry will always evaluate your bootstrap module
 */
export function withRuntime(
  nextConfigOrFn: NextConfigLike | NextConfigFnLike,
  opts: WithRuntimeOptions = {},
): any {
  const bootstrapModule = opts.bootstrapModule ?? "./src/runtime"

  const apply = (nextConfig: any) => {
    const userWebpack = nextConfig.webpack ?? undefined
    ensureDomainRouteFile(bootstrapModule)
    return {
      ...nextConfig,
      webpack: (config: any, options: any) => {
        const out = userWebpack ? userWebpack(config, options) : config

        // NOTE:
        // - We still attempt the patch here for webpack builds.
        // - But for Turbopack builds, this hook may never run, so we ALSO patch
        //   in the config-function wrapper below (after withWorkflow generates the file).
        patchWorkflowStepRouteToImportBootstrap(bootstrapModule)
        ensureDomainRouteFile(bootstrapModule)

        if (!options?.isServer) return out

        const req = createRequire(import.meta.url)
        const contextDir = (out && out.context) || process.cwd()

        // Resolve relative to the app project (webpack context), not to this package.
        const resolvedBootstrap = req.resolve(bootstrapModule, { paths: [contextDir] })

        const originalEntry = out.entry
        out.entry = async () => {
          const entries =
            typeof originalEntry === "function" ? await originalEntry() : originalEntry
          injectBootstrapIntoEntries(entries, resolvedBootstrap)
          return entries
        }
        return out
      },
    }
  }

  // Critical path for Vercel/Turbopack:
  // `@workflow/next` generates `.well-known/workflow/.../route.(ts|js)` inside its config function.
  // So we must patch AFTER that function runs (not inside webpack).
  if (typeof nextConfigOrFn === "function") {
    return async (phase: string, ctx: any) => {
      const cfg = await nextConfigOrFn(phase, ctx)
      patchWorkflowStepRouteToImportBootstrap(bootstrapModule)
      ensureDomainRouteFile(bootstrapModule)
      return apply(cfg)
    }
  }

  // Object config: best-effort patch (file may not exist yet here)
  return apply(nextConfigOrFn)
}
