import { configureRuntime } from "@ekairos/domain/runtime";
import { threadDomain } from "@ekairos/thread";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

// Local DX: load env from repo root if present.
dotenvConfig({ path: resolve(process.cwd(), ".env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env"), quiet: true });

const appId =
  (process.env.NEXT_PUBLIC_INSTANT_APP_ID as string) ||
  (process.env.INSTANT_APP_ID as string) ||
  (process.env.INSTANTDB_APP_ID as string);
const adminToken =
  (process.env.INSTANT_APP_ADMIN_TOKEN as string) ||
  (process.env.INSTANT_ADMIN_TOKEN as string) ||
  (process.env.INSTANTDB_ADMIN_TOKEN as string);

const appDomain =
  appId && adminToken
    ? domain("thread-workflow-smoke")
        .includes(threadDomain)
        .schema({ entities: {}, links: {}, rooms: {} })
    : null;

const db =
  appDomain && appId && adminToken
    ? init({ appId, adminToken, schema: appDomain.toInstantSchema() } as any)
    : null;

export const runtimeConfig =
  appDomain && db
    ? configureRuntime({
        domain: { domain: appDomain },
        runtime: async () => ({ db } as any),
      })
    : null;
