import { resolve } from "node:path"

import { config as dotenvConfig } from "dotenv"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"
import type {
  EntitiesDef,
  InstantSchemaDef,
  LinksDef,
  RoomsDef,
} from "@instantdb/core"
import { describe, it } from "vitest"

const workspaceRoot = resolve(process.cwd(), "..", "..")
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })

type AnyInstantSchema = InstantSchemaDef<EntitiesDef, LinksDef<EntitiesDef>, RoomsDef>
type CreateTestAppResult = {
  appId: string
  adminToken: string
  title: string
}

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

export function hasInstantProvisionToken(): boolean {
  return Boolean(getInstantProvisionToken())
}

export async function provisionThreadTestApp(params: {
  name: string
  schema: AnyInstantSchema
}): Promise<CreateTestAppResult> {
  const token = getInstantProvisionToken()
  if (!token) {
    throw new Error(
      "INSTANT_PERSONAL_ACCESS_TOKEN is required for @ekairos/thread Instant tests.",
    )
  }

  return await createTestApp({
    name: params.name,
    token,
    schema: params.schema,
  })
}

export async function destroyThreadTestApp(appId: string): Promise<void> {
  const token = getInstantProvisionToken()
  if (!token || !appId) return

  await destroyTestApp({
    appId,
    token,
  })
}

export const describeInstant = ((name: string, fn: Parameters<typeof describe>[1]) =>
  (hasInstantProvisionToken() ? describe : describe.skip)(name, fn)) as typeof describe

export const itInstant = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  (hasInstantProvisionToken() ? it : it.skip)(name, fn, timeout)) as typeof it
