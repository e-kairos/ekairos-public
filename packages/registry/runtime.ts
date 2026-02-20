import "server-only";

import { init } from "@instantdb/admin";
import type { DomainSchemaResult } from "@ekairos/domain";
import {
  configureRuntime,
  resolveRuntime as resolveDomainRuntime,
} from "@ekairos/domain/runtime";
import type {
  DomainDbFor,
  DomainRuntime,
  RuntimeResolveOptions,
} from "@ekairos/domain/runtime";
import appDomain from "@/lib/domain";

export type RegistryRuntimeEnv = {
  instant: {
    appId: string;
    adminToken: string;
  };
};

const runtimeDbCache = new Map<string, DomainDbFor<DomainSchemaResult>>();

function normalizeRuntimeEnv(env: RegistryRuntimeEnv): RegistryRuntimeEnv {
  const appId = String(env?.instant?.appId ?? "").trim();
  const adminToken = String(env?.instant?.adminToken ?? "").trim();
  if (!appId || !adminToken) {
    throw new Error("[registry runtime] instant.appId and instant.adminToken are required.");
  }
  return {
    instant: {
      appId,
      adminToken,
    },
  };
}

async function resolveRuntimeDb<D extends DomainSchemaResult>(
  env: RegistryRuntimeEnv,
  domain: D,
): Promise<DomainDbFor<D>> {
  const normalizedEnv = normalizeRuntimeEnv(env);
  const cacheKey = `${normalizedEnv.instant.appId}:${normalizedEnv.instant.adminToken}`;
  const cached = runtimeDbCache.get(cacheKey);
  if (cached) {
    return cached as unknown as DomainDbFor<D>;
  }

  const schema = domain.toInstantSchema();
  const db = init({
    appId: normalizedEnv.instant.appId,
    adminToken: normalizedEnv.instant.adminToken,
    schema,
    useDateObjects: true,
  }) as unknown as DomainDbFor<D>;

  runtimeDbCache.set(cacheKey, db as unknown as DomainDbFor<DomainSchemaResult>);
  return db;
}

export async function resolveRegistryRuntime<D extends DomainSchemaResult>(
  env: RegistryRuntimeEnv,
  domain: D,
  options?: RuntimeResolveOptions,
): Promise<DomainRuntime<D, DomainDbFor<D>>> {
  return await resolveDomainRuntime(domain, env, options);
}

export const runtimeConfig = configureRuntime({
  domain: {
    domain: appDomain,
  },
  runtime: async (env: RegistryRuntimeEnv, domain) => {
    const resolvedDomain = domain as DomainSchemaResult | null | undefined;
    if (!resolvedDomain) {
      throw new Error("[registry runtime] explicit domain is required.");
    }
    const db = await resolveRuntimeDb(env, resolvedDomain);
    return { db };
  },
});

