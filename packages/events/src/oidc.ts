import { createRemoteJWKSet, jwtVerify } from "jose"

type VerifyOidcOptions = {
  jwksUrl?: string
  issuer?: string
  audience?: string | string[]
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUrl: string) {
  const cached = jwksCache.get(jwksUrl)
  if (cached) return cached
  const jwks = createRemoteJWKSet(new URL(jwksUrl))
  jwksCache.set(jwksUrl, jwks)
  return jwks
}

export async function verifyOidcToken(token: string, options: VerifyOidcOptions = {}) {
  if (!token) return false
  const jwksUrl = String(options.jwksUrl ?? "").trim()
  if (!jwksUrl) {
    throw new Error("Missing jwksUrl for OIDC verification")
  }
  const verifyOptions: { issuer?: string; audience?: string | string[] } = {}
  if (options.issuer) verifyOptions.issuer = options.issuer
  if (options.audience) verifyOptions.audience = options.audience
  await jwtVerify(token, getJwks(jwksUrl), verifyOptions)
  return true
}
