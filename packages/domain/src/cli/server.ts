import {
  executeRuntimeAction,
  getRuntimeActions,
  getRuntimeConfig,
  getRuntimeProjectId,
  resolveRuntime,
  type RuntimeDomainAction,
} from "../runtime.js"
import type { RuntimeDomainSource } from "../runtime.js"
import { getDomainActionBinding } from "../index.js"

type RefreshTokenUser = {
  id: string
  email?: string | null
  isGuest?: boolean
}

type AuthActor = {
  id?: string | null
  email?: string | null
  isGuest?: boolean
} | null

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

function listKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  return Object.keys(value as Record<string, unknown>)
}

function resolveSource(config: any): RuntimeDomainSource | null {
  return (config?.domain ?? null) as RuntimeDomainSource | null
}

function buildSchema(source: RuntimeDomainSource | null) {
  if (!source) return null
  if (typeof source.toInstantSchema === "function") return source.toInstantSchema()
  if (typeof source.schema === "function") return source.schema()
  return {
    entities: source.entities ?? {},
    links: source.links ?? {},
    rooms: source.rooms ?? {},
  }
}

function buildContext(config: any, source: RuntimeDomainSource | null) {
  if (!source || typeof source.context !== "function") return null
  return source.context({ meta: config?.meta })
}

function buildContextString(config: any, source: RuntimeDomainSource | null) {
  if (!source || typeof source.contextString !== "function") return null
  return source.contextString({ meta: config?.meta })
}

function serializeActionInputSchema(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function resolveDomainActionKeyByName(source: RuntimeDomainSource | null, actionName: string) {
  if (!source || typeof (source as any).getActions !== "function") return null
  const actions = (source as any).getActions() as unknown[]
  for (const action of actions) {
    const name = String((action as any)?.name ?? "").trim()
    if (name !== actionName) continue
    const binding = getDomainActionBinding(action as any) as any
    if (typeof binding?.key === "string" && binding.key.trim()) {
      return binding.key.trim()
    }
  }
  return null
}

function listActions() {
  const source = resolveSource(getRuntimeConfig())
  return getRuntimeActions().map((action) => {
    const binding = getDomainActionBinding(action as any) as any
    return {
      name: String(action.name ?? "").trim(),
      key:
        typeof binding?.key === "string"
          ? binding.key
          : resolveDomainActionKeyByName(source, String(action.name ?? "").trim()),
      description:
        typeof action.description === "string" ? action.description : null,
      inputSchema: serializeActionInputSchema((action as any).inputSchema),
    }
  })
}

function resolveInstantAppId() {
  return (
    String(process.env.EKAIROS_DOMAIN_APP_ID ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "").trim() ||
    String(process.env.INSTANT_APP_ID ?? "").trim() ||
    String(process.env.INSTANTDB_APP_ID ?? "").trim() ||
    null
  )
}

function resolveInstantApiUri() {
  return (
    String(process.env.EKAIROS_DOMAIN_API_URI ?? "").trim() ||
    String(process.env.INSTANT_API_URI ?? "").trim() ||
    "https://api.instantdb.com"
  )
}

const DEFAULT_OIDC_JWKS = "https://oidc.vercel.com/.well-known/jwks.json"
const DEFAULT_OIDC_ISSUER = "https://oidc.vercel.com"

function parseOptionalBoolean(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

function resolveBearerToken(req: Request) {
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
      process.env.EKAIROS_DOMAIN_AUDIENCE,
  )
}

async function verifyOidcToken(token: string) {
  const { verifyOidcToken: verify } = await import("@ekairos/events/oidc")
  const audience = resolveOidcAudience()
  return await verify(token, {
    jwksUrl: resolveOidcJwksUrl(),
    issuer: resolveOidcIssuer(),
    ...(audience ? { audience } : {}),
  })
}

async function verifyRefreshToken(token: string, appId: string): Promise<RefreshTokenUser | null> {
  const apiURI = resolveInstantApiUri()
  try {
    const response = await fetch(`${apiURI}/runtime/auth/verify_refresh_token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        "app-id": appId,
        "refresh-token": token,
      }),
    })
    if (!response.ok) return null
    const data = (await response.json().catch(() => null)) as any
    const user = data?.user
    if (!user || typeof user.id !== "string") return null
    return {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      isGuest: Boolean(user.isGuest),
    }
  } catch {
    return null
  }
}

async function resolveAuth(req: Request, body: any, source: RuntimeDomainSource | null) {
  const bearerToken = resolveBearerToken(req)
  const appId =
    String(body?.appId ?? "").trim() ||
    resolveInstantAppId() ||
    null

  const auth = {
    authorized: !isAuthRequired(),
    bearerToken,
    bearerType: null as "static" | "oidc" | "refresh-token" | null,
    refreshUser: null as RefreshTokenUser | null,
    appId,
  }

  if (!bearerToken) {
    return auth
  }

  const staticToken = String(process.env.EKAIROS_DOMAIN_TOKEN ?? "").trim()
  if (staticToken && bearerToken === staticToken) {
    auth.authorized = true
    auth.bearerType = "static"
    return auth
  }

  try {
    const ok = await verifyOidcToken(bearerToken)
    if (ok) {
      auth.authorized = true
      auth.bearerType = "oidc"
      return auth
    }
  } catch {
    // ignore
  }

  if (appId) {
    const user = await verifyRefreshToken(bearerToken, appId)
    if (user) {
      auth.authorized = true
      auth.bearerType = "refresh-token"
      auth.refreshUser = user
      return auth
    }
  }

  return auth
}

function resolveImpersonatedDb(
  db: any,
  auth: {
    bearerToken: string | null
    bearerType: "static" | "oidc" | "refresh-token" | null
  },
  body: any,
) {
  if (typeof db?.asUser !== "function") {
    return db
  }

  const asEmail = String(body?.asEmail ?? "").trim()
  const asGuest = Boolean(body?.asGuest)

  if (auth.bearerType === "refresh-token" && auth.bearerToken) {
    return db.asUser({ token: auth.bearerToken })
  }
  if (asEmail) {
    return db.asUser({ email: asEmail })
  }
  if (asGuest) {
    return db.asUser({ guest: true })
  }
  return db
}

function resolveActor(
  auth: {
    bearerType: "static" | "oidc" | "refresh-token" | null
    refreshUser: RefreshTokenUser | null
  },
  body: any,
): AuthActor {
  if (auth.refreshUser) {
    return auth.refreshUser
  }

  const asEmail = String(body?.asEmail ?? "").trim()
  if (asEmail) {
    return { email: asEmail, id: null, isGuest: false }
  }

  if (Boolean(body?.asGuest)) {
    return { id: null, email: null, isGuest: true }
  }

  return null
}

function resolveSourceType(
  auth: {
    bearerType: "static" | "oidc" | "refresh-token" | null
  },
  body: any,
) {
  if (auth.bearerType) return auth.bearerType
  if (String(body?.asEmail ?? "").trim()) return "email" as const
  if (Boolean(body?.asGuest)) return "guest" as const
  if (Boolean(body?.admin)) return "admin" as const
  return "admin" as const
}

function truncateQueryResult(result: Record<string, unknown>) {
  const MAX_QUERY_ROWS = 50
  const output: Record<string, unknown> = {}
  const truncation: Record<string, { returned: number; total: number }> = {}

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function withActorEnv(
  env: Record<string, unknown>,
  auth: {
    bearerToken: string | null
    bearerType: "static" | "oidc" | "refresh-token" | null
    refreshUser: RefreshTokenUser | null
    appId: string | null
  },
) {
  if (auth.bearerType !== "refresh-token" || !auth.refreshUser) {
    return env
  }

  return {
    ...env,
    ...(env.actorId ? {} : { actorId: auth.refreshUser.id }),
    ...(env.actorEmail ? {} : { actorEmail: auth.refreshUser.email ?? null }),
    ...(env.refreshToken ? {} : { refreshToken: auth.bearerToken }),
    ...(env.appId ? {} : { appId: auth.appId }),
  }
}

function createRouteRuntime(env: Record<string, unknown>, resolved: any, db: any) {
  return {
    env,
    async db() {
      return db
    },
    async resolve() {
      return {
        db,
        meta: resolved.meta,
      }
    },
    meta: resolved.meta,
  }
}

function resolveActionByAlias(name: string): RuntimeDomainAction<any, any, any, any> | null {
  const normalized = String(name ?? "").trim()
  if (!normalized) return null
  const actions = getRuntimeActions()
  const source = resolveSource(getRuntimeConfig())
  return (
    actions.find((action) => {
      if (String(action.name ?? "").trim() === normalized) return true
      const binding = getDomainActionBinding(action as any) as any
      const key =
        typeof binding?.key === "string"
          ? binding.key
          : resolveDomainActionKeyByName(source, String(action.name ?? "").trim())
      return typeof key === "string" && key === normalized
    }) ?? null
  )
}

export async function handleDomainCliGet(req: Request): Promise<Response> {
  const config = getRuntimeConfig()
  const source = resolveSource(config)
  const auth = await resolveAuth(req, null, source)
  if (!auth.authorized) {
    return new Response("Unauthorized", { status: 401 })
  }

  const context = buildContext(config, source)
  const schema = context?.schema ?? buildSchema(source)
  const contextString = buildContextString(config, source)

  return json({
    ok: true,
    mode: "full",
    instant: {
      appId: auth.appId,
      apiURI: resolveInstantApiUri(),
      projectId: getRuntimeProjectId() || null,
    },
    auth: {
      required: isAuthRequired(),
      supportsRefreshToken: Boolean(auth.appId),
      supportsBearerToken: true,
    },
    domain: context ?? {
      available: Boolean(source),
      entities: listKeys(source?.entities),
      links: listKeys(source?.links),
      rooms: listKeys(source?.rooms),
      meta: config?.meta ?? {},
    },
    schema,
    contextString,
    actions: listActions(),
  })
}

export async function handleDomainCliPost(req: Request): Promise<Response> {
  const config = getRuntimeConfig()
  const source = resolveSource(config)
  if (!source) {
    return new Response("Runtime domain not configured", { status: 500 })
  }

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const op = String(body?.op ?? (body?.action ? "action" : "query")).trim()
  const auth = await resolveAuth(req, body, source)
  if (!auth.authorized) {
    return new Response("Unauthorized", { status: 401 })
  }

  const env = withActorEnv(asRecord(body?.env), auth)
  const resolved = await resolveRuntime(source, env)
  const actor = resolveActor(auth, body)
  const db = resolveImpersonatedDb(resolved.db, auth, body)
  const sourceType = resolveSourceType(auth, body)

  if (op === "action") {
    const action = resolveActionByAlias(String(body?.action ?? ""))
    if (!action) {
      return json(
        {
          ok: false,
          error: `runtime_action_not_found:${String(body?.action ?? "")}`,
        },
        { status: 404 },
      )
    }

    try {
      const runtime = createRouteRuntime(env, resolved, db)
      const output = await executeRuntimeAction({
        action,
        runtime,
        input: body?.input ?? {},
      })
      return json({
        ok: true,
        action: action.name,
        output,
        actor,
        source: sourceType,
      })
    } catch (error) {
      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          actor,
        },
        { status: 500 },
      )
    }
  }

  const query = body?.query ?? null
  if (!query) {
    return new Response("Missing query", { status: 400 })
  }

  try {
    const result = await db.query(query)
    return json({
      ok: true,
      actor,
      source: sourceType,
      ...truncateQueryResult(asRecord(result)),
    })
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        actor,
      },
      { status: 500 },
    )
  }
}
