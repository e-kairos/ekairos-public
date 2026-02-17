import { init } from "@instantdb/admin"
import { configureRuntime } from "@ekairos/domain/runtime"
import { domain } from "@ekairos/domain"
import { threadDomain } from "@ekairos/thread"
import { datasetDomain } from "../schema"
import { sandboxDomain } from "@ekairos/sandbox"

export async function configureDatasetTestRuntime() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID as string
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN as string

  // Single db for tests:
  // - Story persistence (InstantStore): context_* + story_* + document_*
  // - Dataset persistence: dataset_*
  // - Sandbox persistence: sandbox_sandboxes
  const appDomain = domain("dataset-tests")
    .includes(datasetDomain)
    .includes(sandboxDomain)
    .includes(threadDomain)
    .schema({ entities: {}, links: {}, rooms: {} })

  const db = init({
    appId,
    adminToken,
    schema: appDomain.toInstantSchema(),
  } as any)

  configureRuntime({
    runtime: async () => ({ db } as any),
  })
}

