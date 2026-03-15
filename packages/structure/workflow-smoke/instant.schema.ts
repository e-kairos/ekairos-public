/**
 * Workflow-smoke InstantDB schema entrypoint.
 *
 * PURPOSE:
 * - Used by the test harness to push schema to a temp Instant app.
 * - Not used by runtime code directly.
 */

import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox"
import { eventsDomain } from "@ekairos/events"
import { structureDomain } from "@ekairos/structure"

const appDomain = domain("structure-workflow-smoke")
  .includes(eventsDomain)
  .includes(structureDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const schema = appDomain.toInstantSchema()

export type AppSchema = typeof schema
export default schema
