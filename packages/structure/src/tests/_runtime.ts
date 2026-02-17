import { init } from "@instantdb/admin"
import { configureRuntime } from "@ekairos/domain/runtime"
import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox/schema"
import { structureDomain } from "../schema.js"

export async function configureStructureTestRuntime() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID as string
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN as string

  const appDomain = domain("structure-tests")
    .includes(structureDomain)
    .includes(sandboxDomain)
    .schema({ entities: {}, links: {}, rooms: {} })

  const db = init({
    appId,
    adminToken,
    schema: appDomain.toInstantSchema(),
  } as any)

  configureRuntime({
    runtime: async () => ({ db } as any),
  })

  return { db }
}

