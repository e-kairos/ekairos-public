import {
  executeRuntimeAction,
  type RuntimeDomainSource,
  type RuntimeResolveOptions,
} from "./runtime.js"
import { getDomainActionBinding, getDomainActions } from "./index.js"

type RuntimeLike = {
  env?: Record<string, unknown>
  db(options?: RuntimeResolveOptions): Promise<any>
  meta(): {
    domain?: RuntimeDomainSource | null
    schema?: unknown
    context?: unknown
    contextString?: string
  }
}

export type CreateRuntimeRouteHandlerOptions<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Runtime extends RuntimeLike = RuntimeLike,
> = {
  createRuntime: (env: Env) => Runtime | Promise<Runtime>
  resolveEnv?: (input: {
    req: Request
    body: unknown
  }) => Env | Promise<Env>
}

export type RuntimeRouteHandlers = {
  GET(req: Request): Promise<Response>
  POST(req: Request): Promise<Response>
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function listKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  return Object.keys(value as Record<string, unknown>)
}

async function readBody(req: Request) {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function serializeActionInputSchema(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function resolveActionKey(domain: RuntimeDomainSource | null, action: unknown) {
  const binding = getDomainActionBinding(action as any) as any
  if (typeof binding?.key === "string" && binding.key.trim()) {
    return binding.key.trim()
  }

  if (!domain || typeof (domain as any).getActions !== "function") {
    return undefined
  }

  const actionName = String((action as any)?.name ?? "").trim()
  const actions = (domain as any).getActions() as unknown[]
  for (const candidate of actions) {
    if (String((candidate as any)?.name ?? "").trim() !== actionName) continue
    const candidateBinding = getDomainActionBinding(candidate as any) as any
    if (typeof candidateBinding?.key === "string" && candidateBinding.key.trim()) {
      return candidateBinding.key.trim()
    }
  }

  return undefined
}

function listRuntimeActions(domain: RuntimeDomainSource | null) {
  return getDomainActions(domain).map((action) => ({
    name: String(action.name ?? "").trim(),
    key: resolveActionKey(domain, action),
    description: typeof action.description === "string" ? action.description : null,
    inputSchema: serializeActionInputSchema((action as any).inputSchema),
  }))
}

function findRuntimeAction(domain: RuntimeDomainSource | null, name: string) {
  const normalized = String(name ?? "").trim()
  if (!normalized) return null

  return (
    getDomainActions(domain).find((action) => {
      if (String(action.name ?? "").trim() === normalized) return true
      const key = resolveActionKey(domain, action)
      return typeof key === "string" && key === normalized
    }) ?? null
  )
}

function buildDomainSummary(domain: RuntimeDomainSource | null) {
  if (!domain) {
    return {
      available: false,
      entities: [],
      links: [],
      rooms: [],
      meta: {},
    }
  }

  if (typeof domain.context === "function") {
    return domain.context()
  }

  return {
    available: true,
    entities: listKeys(domain.entities),
    links: listKeys(domain.links),
    rooms: listKeys(domain.rooms),
    meta: domain.meta ?? {},
  }
}

function resolveBearerToken(req: Request) {
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length).trim()
}

function resolveImpersonatedDb(db: any, req: Request, body: any) {
  if (typeof db?.asUser !== "function") return db

  const token = resolveBearerToken(req)
  if (token) return db.asUser({ token })

  const asEmail = String(body?.asEmail ?? "").trim()
  if (asEmail) return db.asUser({ email: asEmail })

  if (Boolean(body?.asGuest)) return db.asUser({ guest: true })

  return db
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

export function createRuntimeRouteHandler<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Runtime extends RuntimeLike = RuntimeLike,
>(options: CreateRuntimeRouteHandlerOptions<Env, Runtime>): RuntimeRouteHandlers {
  async function createRuntimeFor(req: Request, body: unknown): Promise<Runtime> {
    const env = options.resolveEnv
      ? await options.resolveEnv({ req, body })
      : (asRecord((body as any)?.env) as Env)
    return await options.createRuntime(env)
  }

  return {
    async GET(req: Request) {
      const runtime = await createRuntimeFor(req, null)
      const meta = runtime.meta()
      const domain = (meta.domain ?? null) as RuntimeDomainSource | null

      return json({
        ok: true,
        mode: "full",
        instant: {
          appId: String(runtime.env?.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "") || null,
          apiURI: String(process.env.EKAIROS_DOMAIN_API_URI ?? process.env.INSTANT_API_URI ?? "https://api.instantdb.com"),
          projectId: String(process.env.EKAIROS_PROJECT_ID ?? "") || null,
        },
        auth: {
          required: false,
          supportsRefreshToken: true,
          supportsBearerToken: true,
        },
        domain: buildDomainSummary(domain),
        schema: meta.schema,
        contextString: meta.contextString ?? (typeof domain?.contextString === "function" ? domain.contextString() : null),
        actions: listRuntimeActions(domain),
      })
    },

    async POST(req: Request) {
      const body = await readBody(req)
      const runtime = await createRuntimeFor(req, body)
      const meta = runtime.meta()
      const domain = (meta.domain ?? null) as RuntimeDomainSource | null
      const op = String((body as any)?.op ?? ((body as any)?.action ? "action" : "query")).trim()

      const db = resolveImpersonatedDb(await runtime.db(), req, body)

      if (op === "action") {
        const actionName = String((body as any)?.action ?? "")
        const action = findRuntimeAction(domain, actionName)
        if (!action) {
          return json(
            {
              ok: false,
              error: `runtime_action_not_found:${actionName}`,
            },
            { status: 404 },
          )
        }

        try {
          const output = await executeRuntimeAction({
            action: action as any,
            runtime: {
              ...runtime,
              async db() {
                return db
              },
            } as any,
            input: (body as any)?.input ?? {},
          })

          return json({
            ok: true,
            action: action.name,
            output,
            source: "runtime-route",
          })
        } catch (error) {
          return json(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              source: "runtime-route",
            },
            { status: 500 },
          )
        }
      }

      const query = (body as any)?.query ?? null
      if (!query) return new Response("Missing query", { status: 400 })

      try {
        const result = await db.query(query)
        return json({
          ok: true,
          source: "runtime-route",
          ...truncateQueryResult(asRecord(result)),
        })
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            source: "runtime-route",
          },
          { status: 500 },
        )
      }
    },
  }
}
