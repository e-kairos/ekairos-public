// @ekairos/domain-route
import * as __ekairosBootstrap from "../../../../../ekairos.ts"
__ekairosBootstrap?.runtimeConfig?.setup?.()
import { NextResponse } from "next/server"
import { getRuntimeConfig, resolveRuntime } from "@ekairos/domain/runtime"
import { verifyOidcToken } from "@ekairos/thread/oidc"

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

const DEFAULT_OIDC_JWKS = "https://oidc.vercel.com/.well-known/jwks.json"
const DEFAULT_OIDC_ISSUER = "https://oidc.vercel.com"

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
  return String(process.env.EKAIROS_DOMAIN_JWKS_URL ?? "").trim() || DEFAULT_OIDC_JWKS
}

function resolveOidcIssuer() {
  return String(process.env.EKAIROS_DOMAIN_ISSUER ?? "").trim() || DEFAULT_OIDC_ISSUER
}

function resolveOidcAudience() {
  const explicit = String(process.env.EKAIROS_DOMAIN_AUDIENCE ?? "").trim()
  return explicit || null
}

function isAuthRequired() {
  const explicit = parseOptionalBoolean(process.env.EKAIROS_DOMAIN_AUTH_REQUIRED)
  if (explicit !== undefined) return explicit
  return Boolean(
    process.env.EKAIROS_DOMAIN_TOKEN ||
      process.env.EKAIROS_DOMAIN_JWKS_URL ||
      process.env.EKAIROS_DOMAIN_ISSUER ||
      process.env.EKAIROS_DOMAIN_AUDIENCE
  )
}

async function isAuthorized(req) {
  if (!isAuthRequired()) return true
  const token = resolveBearerToken(req)
  if (!token) return false
  const staticToken = process.env.EKAIROS_DOMAIN_TOKEN
  if (staticToken && token === staticToken) return true
  try {
    return await verifyOidcToken(token, {
      jwksUrl: resolveOidcJwksUrl(),
      issuer: resolveOidcIssuer(),
      audience: resolveOidcAudience(),
    })
  } catch {
    return false
  }
}

export async function GET(req) {
  if (!(await isAuthorized(req))) {
    return new NextResponse("Unauthorized", { status: 401 })
  }
  const config = getRuntimeConfig()
  const source = resolveSource(config)
  const context = buildContext(config, source)
  const schema = context?.schema ?? buildSchema(source)
  const contextString = buildContextString(config, source)
  return NextResponse.json({
    mode: "full",
    domain: context ?? buildSummary(config, source),
    schema,
    contextString,
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
      if (total > returned) {
        truncation[key] = { returned, total }
      }
      continue
    }
    output[key] = value
  }

  return {
    data: output,
    truncated: Object.keys(truncation).length > 0 ? truncation : null,
  }
}

export async function POST(req) {
  if (!(await isAuthorized(req))) {
    return new NextResponse("Unauthorized", { status: 401 })
  }
  let body = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const orgId = String(body?.orgId ?? "").trim()
  const query = body?.query ?? null

  if (!orgId || !query) {
    return new NextResponse("Missing orgId or query", { status: 400 })
  }

  const config = getRuntimeConfig()
  const source = resolveSource(config)
  if (!source) {
    return new NextResponse("Runtime domain not configured", { status: 500 })
  }
  const runtime = await resolveRuntime(source, { orgId })
  const result = await runtime.db.query(query)
  return NextResponse.json({
    ok: true,
    ...truncateQueryResult(result),
  })
}
