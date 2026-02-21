import "server-only";

import type { InstantRules } from "@instantdb/core";
import { PlatformApi } from "@instantdb/platform";
import schema from "@/instant.schema";

const TENANT_TITLE_PREFIX = "ekairos-registry-visitor";
const TENANT_MAX_VISITOR_ID_LENGTH = 72;

const DEMO_PERMS: InstantRules = {
  $default: {
    allow: {
      $default: "true",
    },
  },
};

type PlatformApp = {
  id: string;
  title: string;
  adminToken?: string;
};

type CachedTenantCredentials = {
  appId: string;
  adminToken: string;
  title: string;
  visitorId: string;
  updatedAt: number;
};

export type DemoTenantInfo = {
  appId: string;
  adminToken: string;
  title: string;
  visitorId: string;
  created: boolean;
  recovered: boolean;
};

export type DemoTenantStatus = {
  visitorId: string;
  appId: string | null;
  exists: boolean;
  title: string | null;
  reason: "ok" | "missing_app_id" | "app_not_found";
};

const tenantCredentialsByAppId = new Map<string, CachedTenantCredentials>();

function normalizeVisitorId(raw: string): string {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error("visitorId is required.");
  }

  return normalized.slice(0, TENANT_MAX_VISITOR_ID_LENGTH);
}

function normalizeAppId(raw: string | null | undefined): string | null {
  const normalized = String(raw ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildTenantTitle(visitorId: string): string {
  return `${TENANT_TITLE_PREFIX}-${visitorId}`;
}

function getInstantProvisionToken(): string {
  const token =
    process.env.INSTANT_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.INSTANTDB_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.INSTANT_PLATFORM_ACCESS_TOKEN?.trim() ||
    "";

  if (!token) {
    throw new Error(
      "Missing Instant platform token. Configure INSTANT_PERSONAL_ACCESS_TOKEN.",
    );
  }

  return token;
}

function getPlatformApiUri(): string | undefined {
  const raw = String(process.env.INSTANT_API_URI ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

function getPlatformApi(): PlatformApi {
  const token = getInstantProvisionToken();
  const apiURI = getPlatformApiUri();
  return new PlatformApi({
    auth: { token },
    ...(apiURI ? { apiURI } : {}),
  });
}

function toPlatformApp(record: unknown): PlatformApp {
  const appRecord = record as {
    id?: unknown;
    title?: unknown;
    adminToken?: unknown;
  };

  const appId = String(appRecord?.id ?? "").trim();
  const title = String(appRecord?.title ?? "").trim();
  const adminToken = String(appRecord?.adminToken ?? "").trim();

  if (!appId || !title) {
    throw new Error("Invalid Instant app payload.");
  }

  return {
    id: appId,
    title,
    ...(adminToken ? { adminToken } : {}),
  };
}

function setCachedTenantCredentials(params: {
  appId: string;
  adminToken: string;
  title: string;
  visitorId: string;
}) {
  tenantCredentialsByAppId.set(params.appId, {
    appId: params.appId,
    adminToken: params.adminToken,
    title: params.title,
    visitorId: params.visitorId,
    updatedAt: Date.now(),
  });
}

function getCachedTenantCredentials(appId: string): CachedTenantCredentials | null {
  const cached = tenantCredentialsByAppId.get(appId);
  return cached ?? null;
}

async function getAppIfExists(appId: string): Promise<PlatformApp | null> {
  try {
    const api = getPlatformApi();
    const response = await api.getApp(appId);
    return toPlatformApp(response.app);
  } catch {
    return null;
  }
}

export async function ensureDemoTenant(params: {
  visitorId: string;
  appId?: string | null;
}): Promise<DemoTenantInfo> {
  const visitorId = normalizeVisitorId(params.visitorId);
  const requestedAppId = normalizeAppId(params.appId);
  let recoveredFromPreviousTenant = false;

  if (requestedAppId) {
    const existing = await getAppIfExists(requestedAppId);
    if (existing) {
      const cached = getCachedTenantCredentials(existing.id);
      if (cached) {
        return {
          appId: existing.id,
          adminToken: cached.adminToken,
          title: existing.title,
          visitorId,
          created: false,
          recovered: false,
        };
      }
      recoveredFromPreviousTenant = true;
    }
  }

  const api = getPlatformApi();
  const created = await api.createApp({
    title: buildTenantTitle(visitorId),
    schema,
    perms: DEMO_PERMS,
  });
  const app = toPlatformApp(created.app);
  if (!app.adminToken) {
    throw new Error("Instant did not return adminToken for created tenant app.");
  }
  setCachedTenantCredentials({
    appId: app.id,
    adminToken: app.adminToken,
    title: app.title,
    visitorId,
  });

  return {
    appId: app.id,
    adminToken: app.adminToken,
    title: app.title,
    visitorId,
    created: true,
    recovered: Boolean(requestedAppId) || recoveredFromPreviousTenant,
  };
}

export async function getDemoTenantStatus(params: {
  visitorId: string;
  appId?: string | null;
}): Promise<DemoTenantStatus> {
  const visitorId = normalizeVisitorId(params.visitorId);
  const appId = normalizeAppId(params.appId);

  if (!appId) {
    return {
      visitorId,
      appId: null,
      exists: false,
      title: null,
      reason: "missing_app_id",
    };
  }

  const app = await getAppIfExists(appId);
  if (!app) {
    return {
      visitorId,
      appId,
      exists: false,
      title: null,
      reason: "app_not_found",
    };
  }

  return {
    visitorId,
    appId: app.id,
    exists: true,
    title: app.title,
    reason: "ok",
  };
}

export async function destroyDemoTenant(params: {
  appId: string;
}): Promise<{ appId: string; deleted: boolean; title: string | null }> {
  const appId = normalizeAppId(params.appId);
  if (!appId) {
    throw new Error("appId is required.");
  }

  const api = getPlatformApi();
  try {
    const deleted = await api.deleteApp(appId);
    const title = String(deleted?.app?.title ?? "").trim();
    return {
      appId,
      deleted: true,
      title: title || null,
    };
  } catch {
    return {
      appId,
      deleted: false,
      title: null,
    };
  }
}

export async function resolveDemoTenantCredentials(params: {
  appId: string;
}): Promise<{ appId: string; adminToken: string; title: string }> {
  const appId = normalizeAppId(params.appId);
  if (!appId) {
    throw new Error("appId is required.");
  }

  const cached = getCachedTenantCredentials(appId);
  if (!cached) {
    throw new Error(
      `No server-side admin token cache for app ${appId}. Re-initialize tenant before bootstrap.`,
    );
  }

  return {
    appId: cached.appId,
    adminToken: cached.adminToken,
    title: cached.title,
  };
}
