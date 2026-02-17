import { NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { setWorld } from "workflow/runtime";

type WorkflowEnvOverrides = Partial<{
  WORKFLOW_TARGET_WORLD: string;
  WORKFLOW_VERCEL_PROXY_URL: string;
  WORKFLOW_VERCEL_AUTH_TOKEN: string;
  WORKFLOW_VERCEL_ENV: string;
  WORKFLOW_VERCEL_PROJECT: string;
  WORKFLOW_VERCEL_TEAM: string;
  WORKFLOW_LOCAL_DATA_DIR: string;
}>;

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: "unauthorized", reason }, { status: 401 });
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function getApiKeyFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token ? token : null;
}

function requireEkairosBaseUrl(): string {
  const baseUrl =
    process.env.EKAIROS_CORE_BASE_URL ||
    process.env.EKAIROS_BASE_URL;
  if (!baseUrl) {
    throw new Error("[workflow-smoke] Missing EKAIROS_CORE_BASE_URL");
  }
  return stripTrailingSlash(baseUrl);
}

function pickWorkflowEnv(overrides: unknown): WorkflowEnvOverrides {
  const o = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>;
  const keys = [
    "WORKFLOW_TARGET_WORLD",
    "WORKFLOW_VERCEL_PROXY_URL",
    "WORKFLOW_VERCEL_AUTH_TOKEN",
    "WORKFLOW_VERCEL_ENV",
    "WORKFLOW_VERCEL_PROJECT",
    "WORKFLOW_VERCEL_TEAM",
    "WORKFLOW_LOCAL_DATA_DIR",
  ] as const;

  const out: WorkflowEnvOverrides = {};
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) {
      (out as any)[k] = v;
    }
  }
  return out;
}

function applyWorkflowEnv(overrides: WorkflowEnvOverrides) {
  const keys = Object.keys(overrides) as (keyof WorkflowEnvOverrides)[];
  const prev: Record<string, string | undefined> = {};

  for (const k of keys) {
    prev[k] = process.env[k];
    const next = overrides[k];
    if (typeof next === "string" && next.trim()) {
      process.env[k] = next;
    }
  }

  // IMPORTANT: world is cached globally; reset so the next call re-reads env.
  setWorld(undefined);

  return () => {
    for (const k of keys) {
      const old = prev[k];
      if (typeof old === "undefined") {
        delete process.env[k];
      } else {
        process.env[k] = old;
      }
    }
    setWorld(undefined);
  };
}

async function verifyApiKeyWithEkairos(params: { ekairosBaseUrl: string; apiKey: string; orgId: string }) {
  const res = await fetch(`${params.ekairosBaseUrl}/api/webhook/verify-request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({ orgId: params.orgId }),
  });
  return res.ok;
}

export async function POST(req: Request) {
  const apiKey = getApiKeyFromRequest(req);
  if (!apiKey) return unauthorized("api_key_required");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid_json");
  }

  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const token = typeof body?.token === "string" ? body.token : "";
  const data = body?.data;
  const workflowEnv = pickWorkflowEnv(body?.workflowEnv);
  if (!orgId) return badRequest("orgId_required");
  if (!token) return badRequest("token_required");

  const ekairosBaseUrl = requireEkairosBaseUrl();
  const ok = await verifyApiKeyWithEkairos({ ekairosBaseUrl, apiKey, orgId });
  if (!ok) return unauthorized("api_key_invalid");

  const restore = applyWorkflowEnv(workflowEnv);
  try {
    const hook = await resumeHook(token, data);
    if (!hook) {
      return NextResponse.json({ ok: false, error: "hook_not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, runId: hook.runId });
  } finally {
    restore();
  }
}

