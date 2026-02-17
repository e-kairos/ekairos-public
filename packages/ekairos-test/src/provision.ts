import type {
  EntitiesDef,
  InstantRules,
  InstantSchemaDef,
  LinksDef,
  RoomsDef,
} from "@instantdb/core";

type AnyInstantSchema = InstantSchemaDef<EntitiesDef, LinksDef<EntitiesDef>, RoomsDef>;

async function createApi(params: { token: string; apiURI?: string }) {
  const { PlatformApi } = await import("@instantdb/platform");
  const token = String(params.token ?? "").trim();
  if (!token) {
    throw new Error("Instant platform token is required.");
  }
  return new PlatformApi({
    auth: { token },
    ...(params.apiURI ? { apiURI: params.apiURI } : {}),
  });
}

export type CreateTestAppParams = {
  name: string;
  token: string;
  apiURI?: string;
  orgId?: string;
  schema?: AnyInstantSchema;
  perms?: InstantRules;
};

export type CreateTestAppResult = {
  appId: string;
  adminToken: string;
  title: string;
};

export async function createTestApp(
  params: CreateTestAppParams,
): Promise<CreateTestAppResult> {
  const api = await createApi({ token: params.token, apiURI: params.apiURI });
  const name = String(params.name ?? "").trim();
  if (!name) {
    throw new Error("createTestApp requires a non-empty app name.");
  }

  const created = await api.createApp({
    title: name,
    orgId: params.orgId,
    schema: params.schema ?? undefined,
    perms: params.perms ?? undefined,
  });

  const appId = String(created?.app?.id ?? "").trim();
  const adminToken = String((created?.app as any)?.adminToken ?? "").trim();
  const title = String(created?.app?.title ?? name).trim();

  if (!appId || !adminToken) {
    throw new Error("createTestApp did not return appId/adminToken.");
  }

  return { appId, adminToken, title };
}

export type PushTestSchemaParams = {
  appId: string;
  token: string;
  schema: AnyInstantSchema;
  apiURI?: string;
  onProgress?: (status: {
    friendlyDescription: string;
    totalCount: number;
    inProgressCount: number;
    completedCount: number;
    errorCount: number;
    steps: unknown[];
    inProgressSteps: unknown[];
    completedSteps: unknown[];
    erroredSteps: unknown[];
  }) => void;
};

export async function pushTestSchema(
  params: PushTestSchemaParams,
): Promise<{
  newSchema: AnyInstantSchema;
  steps: unknown[];
  summary: unknown;
}> {
  const api = await createApi({ token: params.token, apiURI: params.apiURI });
  const appId = String(params.appId ?? "").trim();
  if (!appId) throw new Error("pushTestSchema requires appId.");

  const push = api.schemaPush(appId, { schema: params.schema });
  if (params.onProgress) {
    push.subscribe({
      next(status) {
        params.onProgress?.(status);
      },
    });
  }
  return (await push) as {
    newSchema: AnyInstantSchema;
    steps: unknown[];
    summary: unknown;
  };
}

export type PushTestPermsParams = {
  appId: string;
  token: string;
  perms: InstantRules;
  apiURI?: string;
};

export async function pushTestPerms(
  params: PushTestPermsParams,
): Promise<{ perms: InstantRules }> {
  const api = await createApi({ token: params.token, apiURI: params.apiURI });
  const appId = String(params.appId ?? "").trim();
  if (!appId) throw new Error("pushTestPerms requires appId.");

  return (await api.pushPerms(appId, { perms: params.perms })) as {
    perms: InstantRules;
  };
}

export type DestroyTestAppParams = {
  appId: string;
  token: string;
  apiURI?: string;
};

export async function destroyTestApp(
  params: DestroyTestAppParams,
): Promise<{
  app: {
    id: string;
    title: string;
    createdAt: Date;
    orgId: string | null;
  };
}> {
  const api = await createApi({ token: params.token, apiURI: params.apiURI });
  const appId = String(params.appId ?? "").trim();
  if (!appId) throw new Error("destroyTestApp requires appId.");
  return (await api.deleteApp(appId)) as {
    app: {
      id: string;
      title: string;
      createdAt: Date;
      orgId: string | null;
    };
  };
}
