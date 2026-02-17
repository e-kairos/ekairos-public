import "server-only";

import { init } from "@instantdb/admin";
import {
  configureRuntime,
  resolveRuntime as resolveDomainRuntime,
  type RuntimeResolveOptions,
} from "@ekairos/domain/runtime";
import appDomain from "@/lib/domain";
import schema from "@/instant.schema";
import type { CreateTestAppResult } from "@ekairos/testing/provision";

type RuntimeEnv = {
  orgId?: string;
  userId?: string;
  appId?: string;
  forceNewApp?: boolean;
};

type RuntimeCredentials = {
  appId: string;
  adminToken: string;
  source: "temp";
  title?: string;
};

const tempRuntimeStoreSymbol = Symbol.for("ekairos.threadElements.tempRuntimeStore");
const MAX_TEMP_APPS_IN_MEMORY = 8;

type TempRuntimeStore = {
  byAppId: Map<string, CreateTestAppResult>;
  currentAppId: string | null;
};

type RuntimeGlobal = typeof globalThis & {
  [tempRuntimeStoreSymbol]?: TempRuntimeStore;
};

function getTokenFromEnv(): string {
  const fromEnv =
    process.env.INSTANT_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.INSTANTDB_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.INSTANT_PLATFORM_ACCESS_TOKEN?.trim();
  return fromEnv || "";
}

function getTempRuntimeStore(): TempRuntimeStore {
  const store = globalThis as RuntimeGlobal;
  if (!store[tempRuntimeStoreSymbol]) {
    store[tempRuntimeStoreSymbol] = {
      byAppId: new Map<string, CreateTestAppResult>(),
      currentAppId: null,
    };
  }
  return store[tempRuntimeStoreSymbol] as TempRuntimeStore;
}

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rememberTempApp(app: CreateTestAppResult) {
  const store = getTempRuntimeStore();
  store.byAppId.set(app.appId, app);
  store.currentAppId = app.appId;

  // Keep a small bounded cache of temp apps in memory.
  while (store.byAppId.size > MAX_TEMP_APPS_IN_MEMORY) {
    const oldestKey = store.byAppId.keys().next().value as string | undefined;
    if (!oldestKey) break;
    if (oldestKey === store.currentAppId && store.byAppId.size > 1) {
      // Skip current and remove next oldest.
      const entries = Array.from(store.byAppId.keys());
      const nextKey = entries.find((entry) => entry !== store.currentAppId);
      if (nextKey) {
        store.byAppId.delete(nextKey);
      } else {
        break;
      }
    } else {
      store.byAppId.delete(oldestKey);
    }
  }
}

export function getCurrentPreviewRuntimeAppId(): string | null {
  return getTempRuntimeStore().currentAppId;
}

export function invalidatePreviewRuntimeApp(appId?: string) {
  const store = getTempRuntimeStore();
  const candidate = trimOrEmpty(appId);
  if (candidate) {
    store.byAppId.delete(candidate);
    if (store.currentAppId === candidate) {
      store.currentAppId = null;
    }
    return;
  }

  store.byAppId.clear();
  store.currentAppId = null;
}

async function resolveRuntimeCredentials(
  env?: RuntimeEnv,
  options?: RuntimeResolveOptions,
): Promise<RuntimeCredentials> {
  const store = getTempRuntimeStore();
  const requestedAppId = trimOrEmpty(env?.appId);
  const forceNew = Boolean(env?.forceNewApp);

  if (!forceNew && requestedAppId) {
    const requested = store.byAppId.get(requestedAppId);
    if (requested) {
      store.currentAppId = requested.appId;
      return {
        appId: requested.appId,
        adminToken: requested.adminToken,
        source: "temp",
        title: requested.title,
      };
    }
  }

  if (!forceNew && store.currentAppId) {
    const current = store.byAppId.get(store.currentAppId);
    if (current) {
      return {
        appId: current.appId,
        adminToken: current.adminToken,
        source: "temp",
        title: current.title,
      };
    }
  }

  if (!forceNew && requestedAppId) {
    // If requested app id exists (e.g. from cookie) but this process has no admin token
    // in memory (process restart), we create a new temp app below.
  }

  const token = getTokenFromEnv();
  if (!token) {
    throw new Error(
      [
        "thread-elements runtime requires an Instant platform token",
        "(INSTANT_PERSONAL_ACCESS_TOKEN or INSTANT_PLATFORM_ACCESS_TOKEN).",
        "Add it to packages/thread-elements/.env.local",
      ].join(" "),
    );
  }

  await options?.onProgress?.({
    state: "provisioning",
    progress: 35,
    message: "Provisioning temporary InstantDB app for registry previews.",
  });

  const { createTestApp } = await import("@ekairos/testing/provision");
  const created = await createTestApp({
    token,
    name: `thread-elements-preview-${Date.now()}`,
    schema: schema as any,
  });

  rememberTempApp(created);
  return {
    appId: created.appId,
    adminToken: created.adminToken,
    source: "temp",
    title: created.title,
  };
}

export function getPreviewRuntimeCredentialsByAppId(
  appId: string,
): CreateTestAppResult | null {
  const key = trimOrEmpty(appId);
  if (!key) return null;
  return getTempRuntimeStore().byAppId.get(key) ?? null;
}

export function listPreviewRuntimeAppIds(): string[] {
  return Array.from(getTempRuntimeStore().byAppId.keys());
}

export const runtimeConfig = configureRuntime<RuntimeEnv>({
  runtime: async (env, _domain, options) => {
    await options?.onProgress?.({
      state: "provisioning",
      progress: 20,
      message: "Preparing InstantDB runtime.",
    });
    const creds = await resolveRuntimeCredentials(env, options);

    const db = init({
      appId: creds.appId,
      adminToken: creds.adminToken,
      schema,
      useDateObjects: true,
    });

    await options?.onProgress?.({
      state: "ready",
      progress: 100,
      message: `Thread-elements runtime ready (temporary app: ${creds.title ?? creds.appId}).`,
    });

    return { db };
  },
  domain: {
    domain: appDomain,
  },
});

export async function resolveRuntime(
  env: RuntimeEnv,
  options?: RuntimeResolveOptions,
) {
  return resolveDomainRuntime(appDomain, env, options);
}
