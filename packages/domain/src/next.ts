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
  /**
   * Whether to auto-generate MCP routes under `/.well-known/domain/mcp/*`.
   *
   * Disable this when the app provides its own MCP route handlers.
   * Defaults to `true`.
   */
  generateMcpRoutes?: boolean
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
const generatedMcpRoutes = new Set<string>()
const mcpRouteMarker = "@ekairos/domain-mcp-route"

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

function ensureMcpRouteFiles(bootstrapModule: string) {
  const cwd = process.cwd()
  const appDir = resolveAppDir(cwd)
  const baseDir = resolve(appDir, ".well-known/domain/mcp")

  const ext = existsSync(resolve(cwd, "tsconfig.json")) ? "ts" : "js"
  const bootstrapAbs = resolve(cwd, bootstrapModule)

  const getBootstrapSpec = (routeDir: string) => {
    let spec = relative(routeDir, bootstrapAbs).replace(/\\/g, "/")
    if (!spec.startsWith(".")) spec = `./${spec}`
    return spec
  }

  const resetRouteFile = (routeDir: string) => {
    const routeTs = resolve(routeDir, "route.ts")
    const routeJs = resolve(routeDir, "route.js")
    if (existsSync(routeTs)) rmSync(routeTs, { force: true })
    if (existsSync(routeJs)) rmSync(routeJs, { force: true })
  }

  const writeRouteFile = (routeDir: string, contents: string[]) => {
    resetRouteFile(routeDir)
    mkdirSync(routeDir, { recursive: true })
    const routeFile = resolve(routeDir, `route.${ext}`)
    writeFileSync(routeFile, contents.join("\n"))
    generatedMcpRoutes.add(routeFile)
  }

  // /.well-known/domain/mcp
  writeRouteFile(baseDir, [
    `// ${mcpRouteMarker}`,
    `import * as __ekairosBootstrap from "${getBootstrapSpec(baseDir)}"`,
    `__ekairosBootstrap?.runtimeConfig?.setup?.()`,
    `import { NextResponse } from "next/server"`,
    ``,
    `const hasRedis = Boolean(process.env.REDIS_URL || process.env.KV_URL)`,
    ``,
    `export function GET() {`,
    `  const transports = hasRedis ? ["sse", "streamable_http"] : ["streamable_http"]`,
    `  const sse = hasRedis ? "/.well-known/domain/mcp/sse" : undefined`,
    `  return NextResponse.json({`,
    `    ok: true,`,
    `    transports,`,
    `    sse,`,
    `    streamableHttp: "/.well-known/domain/mcp/mcp",`,
    `  })`,
    `}`,
    ``,
  ])

  const buildAuthRouteLines = (routeDir: string) => [
    `// ${mcpRouteMarker}`,
    `import * as __ekairosBootstrap from "${getBootstrapSpec(routeDir)}"`,
    `__ekairosBootstrap?.runtimeConfig?.setup?.()`,
    `import { NextResponse } from "next/server"`,
    ``,
    `const allowOrigin = "*";`,
    `const allowHeaders = "authorization, content-type";`,
    `const allowMethods = "GET, OPTIONS";`,
    ``,
    `function corsHeaders() {`,
    `  return {`,
    `    "Access-Control-Allow-Origin": allowOrigin,`,
    `    "Access-Control-Allow-Headers": allowHeaders,`,
    `    "Access-Control-Allow-Methods": allowMethods,`,
    `  };`,
    `}`,
    ``,
    `function resolveScopes() {`,
    `  const raw = String(process.env.EKAIROS_MCP_SCOPES ?? "").trim()`,
    `  if (!raw) return ["domain.query", "domain.actions.list"]`,
    `  return raw`,
    `    .split(",")`,
    `    .map((scope) => scope.trim())`,
    `    .filter(Boolean)`,
    `}`,
    ``,
    `export function GET(req) {`,
    `  const origin = (() => {`,
    `    try { return new URL(req?.url ?? "").origin } catch { return "" }`,
    `  })()`,
    `  const resourcePath = "/.well-known/domain/mcp"`,
    `  const resource = origin ? \`\${origin}\${resourcePath}\` : resourcePath`,
    `  let authorizationServer = String(process.env.EKAIROS_MCP_AUTH_SERVER ?? "").trim() || "/.well-known/oauth-authorization-server";`,
    `  if (authorizationServer && !authorizationServer.startsWith("http") && origin) {`,
    `    authorizationServer = authorizationServer.startsWith("/") ? \`\${origin}\${authorizationServer}\` : \`\${origin}/\${authorizationServer}\``,
    `  }`,
    `  return new NextResponse(`,
    `    JSON.stringify({`,
    `      resource,`,
    `      authorization_servers: authorizationServer ? [authorizationServer] : [],`,
    `      scopes_supported: resolveScopes(),`,
    `      bearer_methods_supported: ["header"],`,
    `    }),`,
    `    {`,
    `      status: 200,`,
    `      headers: {`,
    `        "Content-Type": "application/json",`,
    `        ...corsHeaders(),`,
    `      },`,
    `    },`,
    `  );`,
    `}`,
    ``,
    `export function OPTIONS() {`,
    `  return new NextResponse(null, { status: 204, headers: corsHeaders() });`,
    `}`,
    ``,
  ]

  // /.well-known/domain/mcp/auth
  const authDir = resolve(baseDir, "auth")
  writeRouteFile(authDir, buildAuthRouteLines(authDir))

  // /.well-known/oauth-protected-resource/mcp (official)
  const oauthDir = resolve(appDir, ".well-known/oauth-protected-resource/mcp")
  writeRouteFile(oauthDir, buildAuthRouteLines(oauthDir))

  // /.well-known/domain/mcp/[transport]
  const transportDir = resolve(baseDir, "[transport]")
  writeRouteFile(transportDir, [
    `// ${mcpRouteMarker}`,
    `import * as __ekairosBootstrap from "${getBootstrapSpec(transportDir)}"`,
    `__ekairosBootstrap?.runtimeConfig?.setup?.()`,
    `import { createMcpHandler, withMcpAuth } from "@vercel/mcp-adapter"`,
    `import { getRuntimeConfig, resolveRuntime } from "@ekairos/domain/runtime"`,
    `import { verifyOidcToken } from "@ekairos/thread/oidc"`,
    ``,
    `const DEFAULT_OIDC_JWKS = "https://oidc.vercel.com/.well-known/jwks.json"`,
    `const DEFAULT_OIDC_ISSUER = "https://oidc.vercel.com"`,
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
    `  return (`,
    `    String(process.env.EKAIROS_MCP_JWKS_URL ?? "").trim() ||`,
    `    String(process.env.EKAIROS_DOMAIN_JWKS_URL ?? "").trim() ||`,
    `    DEFAULT_OIDC_JWKS`,
    `  )`,
    `}`,
    ``,
    `function resolveOidcIssuer() {`,
    `  return (`,
    `    String(process.env.EKAIROS_MCP_ISSUER ?? "").trim() ||`,
    `    String(process.env.EKAIROS_DOMAIN_ISSUER ?? "").trim() ||`,
    `    DEFAULT_OIDC_ISSUER`,
    `  )`,
    `}`,
    ``,
    `function resolveOidcAudience() {`,
    `  const explicit =`,
    `    String(process.env.EKAIROS_MCP_AUDIENCE ?? "").trim() ||`,
    `    String(process.env.EKAIROS_DOMAIN_AUDIENCE ?? "").trim()`,
    `  return explicit || null`,
    `}`,
    ``,
    `function resolveAuthRequired(config) {`,
    `  if (typeof config?.mcp?.required === "boolean") return config.mcp.required`,
    `  if (typeof config?.mcp?.resolveAuth === "function") return true`,
    `  const explicit = parseOptionalBoolean(`,
    `    process.env.EKAIROS_MCP_AUTH_REQUIRED ?? process.env.EKAIROS_DOMAIN_AUTH_REQUIRED,`,
    `  )`,
    `  if (explicit !== undefined) return explicit`,
    `  return Boolean(`,
    `    process.env.EKAIROS_MCP_TOKEN ||`,
    `      process.env.EKAIROS_DOMAIN_TOKEN ||`,
    `      process.env.EKAIROS_MCP_JWKS_URL ||`,
    `      process.env.EKAIROS_DOMAIN_JWKS_URL ||`,
    `      process.env.EKAIROS_MCP_ISSUER ||`,
    `      process.env.EKAIROS_DOMAIN_ISSUER ||`,
    `      process.env.EKAIROS_MCP_AUDIENCE ||`,
    `      process.env.EKAIROS_DOMAIN_AUDIENCE`,
    `  )`,
    `}`,
    ``,
    `function resolveAuthContext(ctx) {`,
    `  const info = ctx?.authInfo ?? {}`,
    `  const extra = info.extra && typeof info.extra === "object" ? info.extra : {}`,
    `  const out = { ...extra }`,
    `  if (info.token && !out.token) out.token = info.token`,
    `  if (Array.isArray(info.scopes) && !out.scopes) out.scopes = info.scopes`,
    `  return out`,
    `}`,
    ``,
    `function buildAuthRequiredResponse(params) {`,
    `  const payload = {`,
    `    ok: false,`,
    `    error: "auth_required",`,
    `    action: params.action,`,
    `    requiredScopes: params.requiredScopes ?? [],`,
    `    message: params.message ?? "Authentication required.",`,
    `    auth: {`,
    `      resourceMetadataUrl: "/.well-known/oauth-protected-resource/mcp",`,
    `      authorizationServerUrl: "/.well-known/oauth-authorization-server",`,
    `    },`,
    `  }`,
    `  return {`,
    `    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],`,
    `  }`,
    `}`,
    ``,
    `function buildForbiddenResponse(params) {`,
    `  const payload = {`,
    `    ok: false,`,
    `    error: "forbidden",`,
    `    action: params.action,`,
    `    message: params.message ?? "Not authorized.",`,
    `  }`,
    `  return {`,
    `    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],`,
    `  }`,
    `}`,
    ``,
    `function resolveActionExecute(def) {`,
    `  if (!def) return null`,
    `  if (typeof def.execute === "function") return def.execute`,
    `  if (typeof def === "function") return def`,
    `  return null`,
    `}`,
    ``,
    `function buildQueryTool() {`,
    `  return {`,
    `    name: "domain.query",`,
    `    description: "Ejecuta una consulta InstantQL sobre el dominio.",`,
    `    inputSchema: {`,
    `      type: "object",`,
    `      properties: {`,
    `        orgId: { type: "string", description: "Clerk organization ID." },`,
    `        query: { type: "object", description: "InstantQL query object." },`,
    `      },`,
    `      required: ["orgId", "query"],`,
    `    },`,
    `  }`,
    `}`,
    ``,
    `function rpcError(id, code, message, data) {`,
    `  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } }`,
    `}`,
    ``,
    `function rpcResult(id, result) {`,
    `  return { jsonrpc: "2.0", id: id ?? null, result }`,
    `}`,
    ``,
    `function jsonResponse(payload, status = 200) {`,
    `  return new Response(JSON.stringify(payload), {`,
    `    status,`,
    `    headers: { "content-type": "application/json" },`,
    `  })`,
    `}`,
    ``,
    `function truncateQueryResult(result) {`,
    `  const MAX_QUERY_ROWS = 50`,
    `  const output = {}`,
    `  const truncation = {}`,
    `  for (const [key, value] of Object.entries(result ?? {})) {`,
    `    if (Array.isArray(value)) {`,
    `      const total = value.length`,
    `      const returned = Math.min(total, MAX_QUERY_ROWS)`,
    `      output[key] = value.slice(0, returned)`,
    `      if (total > returned) truncation[key] = { returned, total }`,
    `      continue`,
    `    }`,
    `    output[key] = value`,
    `  }`,
    `  return {`,
    `    data: output,`,
    `    truncated: Object.keys(truncation).length > 0 ? truncation : null,`,
    `  }`,
    `}`,
    ``,
    `async function executeDomainQuery(input, authCtx, config) {`,
    `  const required = resolveAuthRequired(config)`,
    `  if (required && !authCtx?.token && !authCtx?.orgId && !authCtx?.userId) {`,
    `    return {`,
    `      ok: false,`,
    `      code: "auth_required",`,
    `      message: "Authentication required",`,
    `      data: { auth: { resourceMetadataUrl: "/.well-known/oauth-protected-resource/mcp" } },`,
    `    }`,
    `  }`,
    `  const orgId = typeof input?.orgId === "string" ? String(input.orgId) : (authCtx?.orgId ? String(authCtx.orgId) : "")`,
    `  if (!orgId) {`,
    `    return { ok: false, code: "orgId_required", message: "orgId_required" }`,
    `  }`,
    `  const query = input?.query`,
    `  if (!query || typeof query !== "object") {`,
    `    return { ok: false, code: "invalid_query", message: "invalid_query" }`,
    `  }`,
    `  const source = resolveSource(config)`,
    `  if (!source) {`,
    `    return { ok: false, code: "runtime_domain_not_configured", message: "runtime_domain_not_configured" }`,
    `  }`,
    `  const runtime = await resolveRuntime(source, { orgId })`,
    `  const result = await runtime.db.query(query)`,
    `  return { ok: true, data: truncateQueryResult(result) }`,
    `}`,
    ``,
    `async function resolveSimpleAuth(req, config) {`,
    `  const mcp = config?.mcp`,
    `  const bearer = resolveBearerToken(req)`,
    `  if (typeof mcp?.resolveAuth === "function") {`,
    `    const resolved = await mcp.resolveAuth({ req, token: bearer ?? null })`,
    `    if (resolved) return resolved`,
    `  }`,
    `  if (!bearer) return {}`,
    `  const staticToken = String(process.env.EKAIROS_MCP_TOKEN ?? "").trim() || String(process.env.EKAIROS_DOMAIN_TOKEN ?? "").trim()`,
    `  if (staticToken && bearer === staticToken) return { token: bearer }`,
    `  try {`,
    `    const ok = await verifyOidcToken(bearer, {`,
    `      jwksUrl: resolveOidcJwksUrl(),`,
    `      issuer: resolveOidcIssuer(),`,
    `      audience: resolveOidcAudience(),`,
    `    })`,
    `    if (ok) return { token: bearer }`,
    `  } catch {`,
    `    return {}`,
    `  }`,
    `  return {}`,
    `}`,
    ``,
    `async function simpleHandler(req) {`,
    `  debugLog("request", req.method, req.url)`,
    `  if (req.method !== "POST") {`,
    `    return jsonResponse({ error: "method_not_allowed" }, 405)`,
    `  }`,
    `  let body = null`,
    `  try {`,
    `    const raw = await req.text()`,
    `    body = raw ? JSON.parse(raw) : null`,
    `  } catch {`,
    `    debugLog("invalid json")`,
    `    return jsonResponse({ error: "invalid_json" }, 400)`,
    `  }`,
    `  debugLog("body", body)`,
    `  const config = getRuntimeConfig()`,
    `  const queryTool = buildQueryTool()`,
    `  const authCtx = await resolveSimpleAuth(req, config)`,
    `  debugLog("auth", Object.keys(authCtx ?? {}))`,
    `  const handleMessage = async (msg) => {`,
    `    debugLog("handle", msg?.method)`,
    `    if (!msg || msg.jsonrpc !== "2.0") {`,
    `      return rpcError(msg?.id ?? null, -32600, "Invalid Request")`,
    `    }`,
    `    const id = msg.id ?? null`,
    `    const method = msg.method`,
    `    if (method === "initialize") {`,
    `      return rpcResult(id, {`,
    `        protocolVersion: "2024-11-05",`,
    `        capabilities: { tools: { listChanged: true } },`,
    `        serverInfo: { name: "ekairos-domain-mcp", version: "0.1.0" },`,
    `      })`,
    `    }`,
    `    if (method === "tools/list") {`,
    `      return rpcResult(id, { tools: [queryTool] })`,
    `    }`,
    `    if (method === "tools/call") {`,
    `      const params = msg.params ?? {}`,
    `      const toolName = params.name`,
    `      const input = params.arguments ?? {}`,
    `      if (toolName !== queryTool.name) {`,
    `        return rpcError(id, -32601, "Method not found")`,
    `      }`,
    `      const outcome = await executeDomainQuery(input, authCtx, config)`,
    `      if (!outcome.ok) {`,
    `        return rpcError(id, -32001, outcome.message ?? "Query failed", outcome.data)`,
    `      }`,
    `      return rpcResult(id, {`,
    `        content: [`,
    `          { type: "text", text: JSON.stringify({ ok: true, ...outcome.data }, null, 2) },`,
    `        ],`,
    `      })`,
    `    }`,
    `    return rpcError(id, -32601, "Method not found")`,
    `  }`,
    `  const messages = Array.isArray(body) ? body : [body]`,
    `  const results = []`,
    `  for (const msg of messages) {`,
    `    try {`,
    `      const res = await handleMessage(msg)`,
    `      if (res && res.id !== undefined) results.push(res)`,
    `    } catch (err) {`,
    `      debugLog("error", err?.message ?? err)`,
    `      results.push(rpcError(msg?.id ?? null, -32603, "Internal error"))`,
    `    }`,
    `  }`,
    `  const output = Array.isArray(body) ? results : results[0] ?? null`,
    `  debugLog("response", output)`,
    `  const response = jsonResponse(output)`,
    `  debugLog("responseType", response?.constructor?.name, response instanceof Response)`,
    `  return response`,
    `}`,
    ``,
    `const hasRedis = Boolean(process.env.REDIS_URL || process.env.KV_URL)`,
    ``,
    `const mcpHandler = createMcpHandler(`,
    `  (server) => {`,
    `  const config = getRuntimeConfig()`,
    `  const queryTool = buildQueryTool()`,
    ``,
    `  server.tool(queryTool.name, queryTool.description, queryTool.inputSchema, async (input, ctx) => {`,
    `    const authCtx = resolveAuthContext(ctx)`,
    `    const outcome = await executeDomainQuery(input, authCtx, config)`,
    `    if (!outcome.ok) {`,
    `      if (outcome.code === "auth_required") {`,
    `        return buildAuthRequiredResponse({ action: queryTool.name, requiredScopes: [] })`,
    `      }`,
    `      return {`,
    `        content: [{ type: "text", text: JSON.stringify({ ok: false, error: outcome.message, data: outcome.data }, null, 2) }],`,
    `      }`,
    `    }`,
    `    return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...outcome.data }, null, 2) }] }`,
    `  })`,
    `  },`,
    `  {},`,
    `  { basePath: "/.well-known/domain/mcp", disableSse: !hasRedis },`,
    `)`,
    ``,
    `const authHandler = withMcpAuth(`,
    `  mcpHandler,`,
    `  async (req, token) => {`,
    `    const config = getRuntimeConfig()`,
    `    const mcp = config?.mcp`,
    `    const bearer = String(token ?? "").trim() || null`,
    `    if (typeof mcp?.resolveAuth === "function") {`,
    `      const resolved = await mcp.resolveAuth({ req, token: bearer })`,
    `      if (!resolved) return`,
    `      return {`,
    `        token: resolved.token ?? bearer ?? undefined,`,
    `        scopes: Array.isArray(resolved.scopes) ? resolved.scopes : undefined,`,
    `        extra: resolved,`,
    `      }`,
    `    }`,
    `    if (!bearer) return`,
    `    const staticToken = String(process.env.EKAIROS_MCP_TOKEN ?? "").trim() || String(process.env.EKAIROS_DOMAIN_TOKEN ?? "").trim()`,
    `    if (staticToken && bearer === staticToken) {`,
    `      return { token: bearer, extra: { token: bearer } }`,
    `    }`,
    `    try {`,
    `      const ok = await verifyOidcToken(bearer, {`,
    `        jwksUrl: resolveOidcJwksUrl(),`,
    `        issuer: resolveOidcIssuer(),`,
    `        audience: resolveOidcAudience(),`,
    `      })`,
    `      if (ok) {`,
    `        return { token: bearer, extra: { token: bearer } }`,
    `      }`,
    `    } catch {`,
    `      return`,
    `    }`,
    `  },`,
    `  {`,
    `    required: false,`,
    `    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",`,
    `  },`,
    `)`,
    ``,
    `const useAdapter = String(process.env.EKAIROS_MCP_ADAPTER ?? "").trim() === "1"`,
    `const debugMcp = String(process.env.EKAIROS_MCP_DEBUG ?? "").trim() === "1"`,
    `const debugLog = (...args) => { if (debugMcp) console.log("[mcp]", ...args) }`,
    ``,
    `async function handler(req) {`,
    `  if (!useAdapter) return simpleHandler(req)`,
    `  try {`,
    `    const res = await authHandler(req)`,
    `    if (res instanceof Response) return res`,
    `    return jsonResponse({ error: "invalid_mcp_response" }, 500)`,
    `  } catch {`,
    `    return jsonResponse({ error: "mcp_handler_error" }, 500)`,
    `  }`,
    `}`,
    ``,
    `export { handler as GET, handler as POST }`,
    ``,
  ])
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
  const generateMcpRoutes = opts.generateMcpRoutes !== false

  const apply = (nextConfig: any) => {
    const userWebpack = nextConfig.webpack ?? undefined
    ensureDomainRouteFile(bootstrapModule)
    if (generateMcpRoutes) {
      ensureMcpRouteFiles(bootstrapModule)
    }
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
        if (generateMcpRoutes) {
          ensureMcpRouteFiles(bootstrapModule)
        }

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
      if (generateMcpRoutes) {
        ensureMcpRouteFiles(bootstrapModule)
      }
      return apply(cfg)
    }
  }

  // Object config: best-effort patch (file may not exist yet here)
  return apply(nextConfigOrFn)
}



