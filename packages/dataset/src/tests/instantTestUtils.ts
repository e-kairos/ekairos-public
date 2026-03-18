import * as fs from "node:fs/promises"
import * as path from "node:path"
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

export type InstantTestApp = {
  appId: string
  adminToken: string
  title: string
}

type AnyInstantSchema = InstantSchemaDef<EntitiesDef, LinksDef<EntitiesDef>, RoomsDef>

const ARTIFACT_PATH = path.resolve(process.cwd(), "test-results", "instant-test-app.json")

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

export async function writeInstantTestApp(app: InstantTestApp) {
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true })
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(app, null, 2), "utf8")
}

export async function readInstantTestApp(): Promise<InstantTestApp | null> {
  try {
    const raw = await fs.readFile(ARTIFACT_PATH, "utf8")
    return JSON.parse(raw) as InstantTestApp
  } catch {
    return null
  }
}

export async function createTempInstantApp(params: {
  title: string
  schema?: AnyInstantSchema
}): Promise<InstantTestApp> {
  const token = getInstantProvisionToken()
  if (!token) {
    throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN is required for Instant temp app creation")
  }

  const app = await createTestApp({
    name: params.title,
    token,
    schema: params.schema,
  })
  await writeInstantTestApp(app)
  return app
}

export async function destroyTempInstantApp(appId: string): Promise<void> {
  const token = getInstantProvisionToken()
  if (!token || !appId) return
  await destroyTestApp({ appId, token })
}

export async function getOrCreateInstantTestApp(params: {
  title: string
  schema?: AnyInstantSchema
}): Promise<InstantTestApp> {
  const persist = String(process.env.APP_TEST_PERSIST ?? "").trim() === "true"
  if (persist) {
    const existing = await readInstantTestApp()
    if (existing?.appId && existing?.adminToken) return existing
  } else {
    try {
      await fs.rm(ARTIFACT_PATH, { force: true })
    } catch {
      // ignore
    }
  }

  return await createTempInstantApp(params)
}
