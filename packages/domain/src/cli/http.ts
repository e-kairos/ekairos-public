import type {
  DomainCliActionResponse,
  DomainCliManifest,
  DomainCliQueryResponse,
} from "./types.js"

export function normalizeBaseUrl(value: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) {
    throw new Error("baseUrl is required")
  }
  const withProtocol =
    /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function authHeaders(refreshToken?: string) {
  const token = String(refreshToken ?? "").trim()
  return token
    ? {
        authorization: `Bearer ${token}`,
      }
    : {}
}

export async function fetchDomainManifest(params: {
  baseUrl: string
  refreshToken?: string
}): Promise<DomainCliManifest> {
  const baseUrl = normalizeBaseUrl(params.baseUrl)
  const res = await fetch(`${baseUrl}/.well-known/ekairos/v1/domain`, {
    method: "GET",
    headers: {
      ...authHeaders(params.refreshToken),
    },
  })

  const data = await parseJsonResponse<DomainCliManifest>(res)
  if (!res.ok || !data || data.ok !== true) {
    throw new Error(
      `Failed to fetch domain manifest (${res.status}): ${res.statusText || "request_failed"}`,
    )
  }

  return data
}

export async function postDomainQuery(params: {
  baseUrl: string
  appId?: string
  refreshToken?: string
  query: Record<string, unknown>
  env?: Record<string, unknown>
  admin?: boolean
  asEmail?: string
  asGuest?: boolean
}): Promise<DomainCliQueryResponse> {
  const baseUrl = normalizeBaseUrl(params.baseUrl)
  const res = await fetch(`${baseUrl}/.well-known/ekairos/v1/domain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(params.refreshToken),
    },
    body: JSON.stringify({
      op: "query",
      ...(params.appId ? { appId: params.appId } : {}),
      query: params.query,
      ...(params.env ? { env: params.env } : {}),
      ...(params.admin ? { admin: true } : {}),
      ...(params.asEmail ? { asEmail: params.asEmail } : {}),
      ...(params.asGuest ? { asGuest: true } : {}),
    }),
  })

  const data = await parseJsonResponse<DomainCliQueryResponse>(res)
  if (data) return data
  return {
    ok: false,
    status: res.status,
    error: await res.text().catch(() => "domain_query_failed"),
  }
}

export async function postDomainAction(params: {
  baseUrl: string
  appId?: string
  refreshToken?: string
  action: string
  input: unknown
  env?: Record<string, unknown>
  admin?: boolean
  asEmail?: string
  asGuest?: boolean
}): Promise<DomainCliActionResponse> {
  const baseUrl = normalizeBaseUrl(params.baseUrl)
  const res = await fetch(`${baseUrl}/.well-known/ekairos/v1/domain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(params.refreshToken),
    },
    body: JSON.stringify({
      op: "action",
      ...(params.appId ? { appId: params.appId } : {}),
      action: params.action,
      input: params.input,
      ...(params.env ? { env: params.env } : {}),
      ...(params.admin ? { admin: true } : {}),
      ...(params.asEmail ? { asEmail: params.asEmail } : {}),
      ...(params.asGuest ? { asGuest: true } : {}),
    }),
  })

  const data = await parseJsonResponse<DomainCliActionResponse>(res)
  if (data) return data
  return {
    ok: false,
    status: res.status,
    error: await res.text().catch(() => "domain_action_failed"),
  }
}
