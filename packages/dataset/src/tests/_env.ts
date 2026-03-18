import { describe, it } from "vitest"
import { getOrCreateInstantTestApp } from "./instantTestUtils"
import type {
  EntitiesDef,
  InstantSchemaDef,
  LinksDef,
  RoomsDef,
} from "@instantdb/core"

type AnyInstantSchema = InstantSchemaDef<EntitiesDef, LinksDef<EntitiesDef>, RoomsDef>

export function hasInstantAdmin(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INSTANT_APP_ID && process.env.INSTANT_APP_ADMIN_TOKEN)
}

export function hasInstantProvisionToken(): boolean {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim())
}

export async function setupInstantTestEnv(title: string, schema?: AnyInstantSchema): Promise<true> {
  delete process.env.DATASET_TEST_LOCAL_SANDBOX
  delete process.env.DATASET_SANDBOX_WORKDIR_BASE
  if (hasInstantAdmin()) return true
  if (!hasInstantProvisionToken()) {
    throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN is required for dataset Instant tests.")
  }

  const app = await getOrCreateInstantTestApp({ title, schema })
  process.env.NEXT_PUBLIC_INSTANT_APP_ID = app.appId
  process.env.INSTANT_APP_ADMIN_TOKEN = app.adminToken
  return true
}

export const describeInstant = ((name: string, fn: Parameters<typeof describe>[1]) =>
  describe(name, fn)) as typeof describe

export const itInstant = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  it(name, fn, timeout)) as typeof it
