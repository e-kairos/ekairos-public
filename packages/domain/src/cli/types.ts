export type DomainCliManifestAction = {
  name: string
  key?: string | null
  description?: string | null
  inputSchema?: unknown
}

export type DomainCliManifest = {
  ok: true
  mode: "full"
  instant: {
    appId?: string | null
    apiURI?: string | null
  }
  auth: {
    required: boolean
    supportsRefreshToken: boolean
    supportsBearerToken: boolean
  }
  domain: unknown
  schema?: unknown
  contextString?: string | null
  actions: DomainCliManifestAction[]
}

export type DomainCliQueryResponse = {
  ok: boolean
  data?: unknown
  truncated?: Record<string, { returned: number; total: number }> | null
  error?: string
  status?: number
  actor?: {
    id?: string | null
    email?: string | null
    isGuest?: boolean
  } | null
  source?: "admin" | "guest" | "email" | "refresh-token" | "static" | "oidc" | null
}

export type DomainCliActionResponse = {
  ok: boolean
  action?: string
  output?: unknown
  error?: string
  status?: number
  actor?: {
    id?: string | null
    email?: string | null
    isGuest?: boolean
  } | null
}

export type DomainCliSession = {
  version: 1
  baseUrl: string
  appId: string
  refreshToken: string
  apiURI: string
  savedAt: string
}
