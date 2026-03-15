import type { ContextEnvironment } from "../context.config.js";
import type { ContextMirrorRequest, ContextMirrorWrite } from "../mirror.js";

function requireOrgId(env: ContextEnvironment): string {
  const orgId = (env as any)?.orgId;
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("[context/mirror] Missing env.orgId");
  }
  return orgId;
}

function requireBaseUrl(): string {
  const baseUrl =
    process.env.EKAIROS_CORE_BASE_URL ||
    process.env.EKAIROS_MIRROR_BASE_URL ||
    process.env.EKAIROS_BASE_URL;
  if (!baseUrl) {
    throw new Error("[context/mirror] Missing EKAIROS_CORE_BASE_URL (or EKAIROS_MIRROR_BASE_URL)");
  }
  return baseUrl.replace(/\/$/, "");
}

function requireToken(): string {
  // Preferred: Clerk org API key (opaque token) for ekairos-core.
  const apiKey = process.env.EKAIROS_CLERK_API_KEY;
  if (apiKey) return apiKey;

  // Fallback: shared secret token.
  const token = process.env.EKAIROS_CONTEXT_MIRROR_TOKEN;
  if (token) return token;

  throw new Error("[context/mirror] Missing EKAIROS_CLERK_API_KEY (or EKAIROS_CONTEXT_MIRROR_TOKEN fallback)");
}

export async function mirrorContextWrites(params: {
  env: ContextEnvironment;
  writes: ContextMirrorWrite[];
}) {
  "use step";

  if (!params.writes?.length) return;

  const orgId = requireOrgId(params.env);
  const baseUrl = requireBaseUrl();
  const token = requireToken();

  const body: ContextMirrorRequest = { orgId, writes: params.writes };

  const res = await fetch(`${baseUrl}/api/context`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[context/mirror] ekairos-core write failed (${res.status}): ${text}`);
  }
}

