export type DomainQueryInput = {
  baseUrl?: string;
  token?: string;
  orgId?: string;
  query: Record<string, unknown>;
};

export type DomainQueryResult = {
  ok: boolean;
  data?: unknown;
  truncated?: boolean;
  error?: string;
  status?: number;
};

export async function queryDomain(input: DomainQueryInput): Promise<DomainQueryResult> {
  "use step";

  const baseUrl =
    String(input.baseUrl || process.env.EKAIROS_DOMAIN_BASE_URL || "").trim();
  if (!baseUrl) {
    return { ok: false, error: "Missing EKAIROS_DOMAIN_BASE_URL" };
  }

  const token =
    String(input.token || process.env.EKAIROS_DOMAIN_OIDC_TOKEN || process.env.EKAIROS_DOMAIN_TOKEN || "").trim();

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(new URL("/.well-known/ekairos/v1/domain", baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ orgId: input.orgId, query: input.query }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text || "domain_query_failed" };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, error: "invalid_domain_json" };
  }
}

export type TransformInput = {
  rows: Array<Record<string, unknown>>;
  program: string;
};

export type TransformResult = {
  ok: boolean;
  rows?: Array<Record<string, unknown>>;
  error?: string;
};

export async function transform(input: TransformInput): Promise<TransformResult> {
  "use step";

  if (!Array.isArray(input.rows)) {
    return { ok: false, error: "rows_required" };
  }
  if (!input.program || typeof input.program !== "string") {
    return { ok: false, error: "program_required" };
  }

  try {
    const fn = new Function("rows", input.program) as (rows: Array<Record<string, unknown>>) => unknown;
    const result = fn(input.rows);
    if (!Array.isArray(result)) {
      return { ok: false, error: "transform_must_return_array" };
    }
    return { ok: true, rows: result as Array<Record<string, unknown>> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SessionInput = {
  orgId?: string;
  baseUrl?: string;
  token?: string;
  query: unknown;
};

export type SessionOutput = {
  ok: boolean;
  rows?: Array<Record<string, unknown>>;
};

function resolveQuery(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export async function runSession(input: SessionInput): Promise<SessionOutput> {
  "use workflow";

  // AI-generated logic should live here. The only required tools are:
  // - queryDomain(...)
  // - transform(...)
  // The compiler will process this function for durable execution.

  const domainResult = await queryDomain({
    baseUrl: input.baseUrl,
    token: input.token,
    orgId: input.orgId,
    query: resolveQuery(input.query),
  });

  if (!domainResult.ok) {
    return { ok: false };
  }

  const transformResult = await transform({
    rows: Array.isArray(domainResult.data) ? (domainResult.data as any) : [],
    program: "return rows;",
  });

  return { ok: transformResult.ok, rows: transformResult.rows };
}
