// @ekairos/domain-mcp-route
import * as __ekairosBootstrap from "../../../../../ekairos.ts"
__ekairosBootstrap?.runtimeConfig?.setup?.()
import { createMcpHandler, withMcpAuth } from "@vercel/mcp-adapter"
import { getRuntimeConfig, resolveRuntime } from "@ekairos/domain/runtime"
import { verifyOidcToken } from "@ekairos/thread/oidc"

const DEFAULT_OIDC_JWKS = "https://oidc.vercel.com/.well-known/jwks.json"
const DEFAULT_OIDC_ISSUER = "https://oidc.vercel.com"

function listKeys(value) {
  return value ? Object.keys(value) : []
}

function resolveSource(config) {
  return config?.domain ?? null
}

function buildSchema(source) {
  if (!source) return null
  if (typeof source.toInstantSchema === "function") return source.toInstantSchema()
  if (typeof source.schema === "function") return source.schema()
  return {
    entities: source.entities ?? {},
    links: source.links ?? {},
    rooms: source.rooms ?? {},
  }
}

function buildSummary(config, source) {
  return {
    available: Boolean(source),
    entities: listKeys(source?.entities),
    links: listKeys(source?.links),
    rooms: listKeys(source?.rooms),
    meta: config?.meta ?? {},
  }
}

function buildContext(config, source) {
  if (!source || typeof source.context !== "function") return null
  return source.context({
    meta: config?.meta,
  })
}

function buildContextString(config, source) {
  if (!source || typeof source.contextString !== "function") return null
  return source.contextString({
    meta: config?.meta,
  })
}

function parseOptionalBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

function resolveBearerToken(req) {
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length).trim()
}

function resolveOidcJwksUrl() {
  return (
    String(process.env.EKAIROS_MCP_JWKS_URL ?? "").trim() ||
    String(process.env.EKAIROS_DOMAIN_JWKS_URL ?? "").trim() ||
    DEFAULT_OIDC_JWKS
  )
}

function resolveOidcIssuer() {
  return (
    String(process.env.EKAIROS_MCP_ISSUER ?? "").trim() ||
    String(process.env.EKAIROS_DOMAIN_ISSUER ?? "").trim() ||
    DEFAULT_OIDC_ISSUER
  )
}

function resolveOidcAudience() {
  const explicit =
    String(process.env.EKAIROS_MCP_AUDIENCE ?? "").trim() ||
    String(process.env.EKAIROS_DOMAIN_AUDIENCE ?? "").trim()
  return explicit || null
}

function resolveAuthRequired(config) {
  if (typeof config?.mcp?.required === "boolean") return config.mcp.required
  if (typeof config?.mcp?.resolveAuth === "function") return true
  const explicit = parseOptionalBoolean(
    process.env.EKAIROS_MCP_AUTH_REQUIRED ?? process.env.EKAIROS_DOMAIN_AUTH_REQUIRED,
  )
  if (explicit !== undefined) return explicit
  return Boolean(
    process.env.EKAIROS_MCP_TOKEN ||
      process.env.EKAIROS_DOMAIN_TOKEN ||
      process.env.EKAIROS_MCP_JWKS_URL ||
      process.env.EKAIROS_DOMAIN_JWKS_URL ||
      process.env.EKAIROS_MCP_ISSUER ||
      process.env.EKAIROS_DOMAIN_ISSUER ||
      process.env.EKAIROS_MCP_AUDIENCE ||
      process.env.EKAIROS_DOMAIN_AUDIENCE
  )
}

function resolveAuthContext(ctx) {
  const info = ctx?.authInfo ?? {}
  const extra = info.extra && typeof info.extra === "object" ? info.extra : {}
  const out = { ...extra }
  if (info.token && !out.token) out.token = info.token
  if (Array.isArray(info.scopes) && !out.scopes) out.scopes = info.scopes
  return out
}

function buildAuthRequiredResponse(params) {
  const payload = {
    ok: false,
    error: "auth_required",
    action: params.action,
    requiredScopes: params.requiredScopes ?? [],
    message: params.message ?? "Authentication required.",
    auth: {
      resourceMetadataUrl: "/.well-known/oauth-protected-resource/mcp",
      authorizationServerUrl: "/.well-known/oauth-authorization-server",
    },
  }
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  }
}

function buildForbiddenResponse(params) {
  const payload = {
    ok: false,
    error: "forbidden",
    action: params.action,
    message: params.message ?? "Not authorized.",
  }
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  }
}

function resolveActionExecute(def) {
  if (!def) return null
  if (typeof def.execute === "function") return def.execute
  if (typeof def === "function") return def
  return null
}

function buildQueryTool() {
  return {
    name: "domain.query",
    description: "Ejecuta una consulta InstantQL sobre el dominio.",
    inputSchema: {
      type: "object",
      properties: {
        orgId: { type: "string", description: "Clerk organization ID." },
        query: { type: "object", description: "InstantQL query object." },
      },
      required: ["orgId", "query"],
    },
  }
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function truncateQueryResult(result) {
  const MAX_QUERY_ROWS = 50
  const output = {}
  const truncation = {}
  for (const [key, value] of Object.entries(result ?? {})) {
    if (Array.isArray(value)) {
      const total = value.length
      const returned = Math.min(total, MAX_QUERY_ROWS)
      output[key] = value.slice(0, returned)
      if (total > returned) truncation[key] = { returned, total }
      continue
    }
    output[key] = value
  }
  return {
    data: output,
    truncated: Object.keys(truncation).length > 0 ? truncation : null,
  }
}

async function executeDomainQuery(input, authCtx, config) {
  const required = resolveAuthRequired(config)
  if (required && !authCtx?.token && !authCtx?.orgId && !authCtx?.userId) {
    return {
      ok: false,
      code: "auth_required",
      message: "Authentication required",
      data: { auth: { resourceMetadataUrl: "/.well-known/oauth-protected-resource/mcp" } },
    }
  }
  const orgId = typeof input?.orgId === "string" ? String(input.orgId) : (authCtx?.orgId ? String(authCtx.orgId) : "")
  if (!orgId) {
    return { ok: false, code: "orgId_required", message: "orgId_required" }
  }
  const query = input?.query
  if (!query || typeof query !== "object") {
    return { ok: false, code: "invalid_query", message: "invalid_query" }
  }
  const source = resolveSource(config)
  if (!source) {
    return { ok: false, code: "runtime_domain_not_configured", message: "runtime_domain_not_configured" }
  }
  const runtime = await resolveRuntime(source, { orgId })
  const result = await runtime.db.query(query)
  return { ok: true, data: truncateQueryResult(result) }
}

async function resolveSimpleAuth(req, config) {
  const mcp = config?.mcp
  const bearer = resolveBearerToken(req)
  if (typeof mcp?.resolveAuth === "function") {
    const resolved = await mcp.resolveAuth({ req, token: bearer ?? null })
    if (resolved) return resolved
  }
  if (!bearer) return {}
  const staticToken = String(process.env.EKAIROS_MCP_TOKEN ?? "").trim() || String(process.env.EKAIROS_DOMAIN_TOKEN ?? "").trim()
  if (staticToken && bearer === staticToken) return { token: bearer }
  try {
    const ok = await verifyOidcToken(bearer, {
      jwksUrl: resolveOidcJwksUrl(),
      issuer: resolveOidcIssuer(),
      audience: resolveOidcAudience(),
    })
    if (ok) return { token: bearer }
  } catch {
    return {}
  }
  return {}
}

async function simpleHandler(req) {
  debugLog("request", req.method, req.url)
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405)
  }
  let body = null
  try {
    const raw = await req.text()
    body = raw ? JSON.parse(raw) : null
  } catch {
    debugLog("invalid json")
    return jsonResponse({ error: "invalid_json" }, 400)
  }
  debugLog("body", body)
  const config = getRuntimeConfig()
  const queryTool = buildQueryTool()
  const authCtx = await resolveSimpleAuth(req, config)
  debugLog("auth", Object.keys(authCtx ?? {}))
  const handleMessage = async (msg) => {
    debugLog("handle", msg?.method)
    if (!msg || msg.jsonrpc !== "2.0") {
      return rpcError(msg?.id ?? null, -32600, "Invalid Request")
    }
    const id = msg.id ?? null
    const method = msg.method
    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "ekairos-domain-mcp", version: "0.1.0" },
      })
    }
    if (method === "tools/list") {
      return rpcResult(id, { tools: [queryTool] })
    }
    if (method === "tools/call") {
      const params = msg.params ?? {}
      const toolName = params.name
      const input = params.arguments ?? {}
      if (toolName !== queryTool.name) {
        return rpcError(id, -32601, "Method not found")
      }
      const outcome = await executeDomainQuery(input, authCtx, config)
      if (!outcome.ok) {
        return rpcError(id, -32001, outcome.message ?? "Query failed", outcome.data)
      }
      return rpcResult(id, {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, ...outcome.data }, null, 2) },
        ],
      })
    }
    return rpcError(id, -32601, "Method not found")
  }
  const messages = Array.isArray(body) ? body : [body]
  const results = []
  for (const msg of messages) {
    try {
      const res = await handleMessage(msg)
      if (res && res.id !== undefined) results.push(res)
    } catch (err) {
      debugLog("error", err?.message ?? err)
      results.push(rpcError(msg?.id ?? null, -32603, "Internal error"))
    }
  }
  const output = Array.isArray(body) ? results : results[0] ?? null
  debugLog("response", output)
  const response = jsonResponse(output)
  debugLog("responseType", response?.constructor?.name, response instanceof Response)
  return response
}

const hasRedis = Boolean(process.env.REDIS_URL || process.env.KV_URL)

const mcpHandler = createMcpHandler(
  (server) => {
  const config = getRuntimeConfig()
  const queryTool = buildQueryTool()

  server.tool(queryTool.name, queryTool.description, queryTool.inputSchema, async (input, ctx) => {
    const authCtx = resolveAuthContext(ctx)
    const outcome = await executeDomainQuery(input, authCtx, config)
    if (!outcome.ok) {
      if (outcome.code === "auth_required") {
        return buildAuthRequiredResponse({ action: queryTool.name, requiredScopes: [] })
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: outcome.message, data: outcome.data }, null, 2) }],
      }
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...outcome.data }, null, 2) }] }
  })
  },
  {},
  { basePath: "/.well-known/domain/mcp", disableSse: !hasRedis },
)

const authHandler = withMcpAuth(
  mcpHandler,
  async (req, token) => {
    const config = getRuntimeConfig()
    const mcp = config?.mcp
    const bearer = String(token ?? "").trim() || null
    if (typeof mcp?.resolveAuth === "function") {
      const resolved = await mcp.resolveAuth({ req, token: bearer })
      if (!resolved) return
      return {
        token: resolved.token ?? bearer ?? undefined,
        scopes: Array.isArray(resolved.scopes) ? resolved.scopes : undefined,
        extra: resolved,
      }
    }
    if (!bearer) return
    const staticToken = String(process.env.EKAIROS_MCP_TOKEN ?? "").trim() || String(process.env.EKAIROS_DOMAIN_TOKEN ?? "").trim()
    if (staticToken && bearer === staticToken) {
      return { token: bearer, extra: { token: bearer } }
    }
    try {
      const ok = await verifyOidcToken(bearer, {
        jwksUrl: resolveOidcJwksUrl(),
        issuer: resolveOidcIssuer(),
        audience: resolveOidcAudience(),
      })
      if (ok) {
        return { token: bearer, extra: { token: bearer } }
      }
    } catch {
      return
    }
  },
  {
    required: false,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  },
)

const useAdapter = String(process.env.EKAIROS_MCP_ADAPTER ?? "").trim() === "1"
const debugMcp = String(process.env.EKAIROS_MCP_DEBUG ?? "").trim() === "1"
const debugLog = (...args) => { if (debugMcp) console.log("[mcp]", ...args) }

async function handler(req) {
  if (!useAdapter) return simpleHandler(req)
  try {
    const res = await authHandler(req)
    if (res instanceof Response) return res
    return jsonResponse({ error: "invalid_mcp_response" }, 500)
  } catch {
    return jsonResponse({ error: "mcp_handler_error" }, 500)
  }
}

export { handler as GET, handler as POST }
