import { init, type InstantAdminDatabase } from "@instantdb/admin";
import { datasetDomain, DatasetService } from "@ekairos/dataset";
import type { SchemaOf } from "@ekairos/domain";

export type DatasetDb = InstantAdminDatabase<SchemaOf<typeof datasetDomain>>;

export type DatasetsOptions = {
  db?: DatasetDb;
  appId?: string;
  adminToken?: string;
  schema?: unknown;
};

export type DatasetsClient = {
  db: DatasetDb;
  domain: typeof datasetDomain;
  service: DatasetService;
};

function resolveAppId(options: DatasetsOptions): string {
  return (
    options.appId ??
    process.env.INSTANT_APP_ID ??
    process.env.NEXT_PUBLIC_INSTANT_APP_ID ??
    ""
  );
}

function resolveAdminToken(options: DatasetsOptions): string {
  return options.adminToken ?? process.env.INSTANT_APP_ADMIN_TOKEN ?? "";
}

export function datasets(options: DatasetsOptions = {}): DatasetsClient {
  if (options.db) {
    return {
      db: options.db,
      domain: datasetDomain,
      service: new DatasetService(options.db),
    };
  }

  const appId = resolveAppId(options);
  const adminToken = resolveAdminToken(options);

  if (!appId || !adminToken) {
    throw new Error(
      "datasets() requires Instant credentials. Provide { db } or { appId, adminToken }.",
    );
  }

  const schema =
    options.schema ??
    (typeof (datasetDomain as any).toInstantSchema === "function"
      ? (datasetDomain as any).toInstantSchema()
      : typeof (datasetDomain as any).schema === "function"
        ? (datasetDomain as any).schema()
        : undefined);
  const db = init({ appId, adminToken, ...(schema ? { schema } : {}) }) as DatasetDb;

  return {
    db,
    domain: datasetDomain,
    service: new DatasetService(db),
  };
}
