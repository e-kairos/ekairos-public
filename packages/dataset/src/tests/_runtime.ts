import { init } from "@instantdb/admin"
import { configureRuntime } from "@ekairos/domain/runtime"
import { domain } from "@ekairos/domain"
import { eventsDomain } from "@ekairos/events"
import { datasetDomain } from "../schema"
import { sandboxDomain } from "@ekairos/sandbox"
import { attachMockInstantStreams } from "./_streams"

export async function configureDatasetTestRuntime() {
  process.env.SANDBOX_PROVIDER = "daytona"
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID as string
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN as string

  // Single db for tests:
  // - Context persistence (InstantStore): context_* + story_* + document_*
  // - Dataset persistence: dataset_*
  // - Sandbox persistence: sandbox_sandboxes
  const appDomain = domain("dataset-tests")
    .includes(datasetDomain)
    .includes(sandboxDomain)
    .includes(eventsDomain)
    .schema({ entities: {}, links: {}, rooms: {} })

  const db = init({
    appId,
    adminToken,
    schema: appDomain.toInstantSchema(),
  } as any)
  attachMockInstantStreams(db)

  configureRuntime({
    runtime: async () => ({ db } as any),
  })
}

