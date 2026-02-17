import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox"
import { structureDomain } from "./src/schema"

/**
 * This file exists exclusively for pushing schema to an Instant app via `instant-cli`.
 *
 * It is NOT used by the library at runtime.
 */
const appDomain = domain("structure")
  .includes(structureDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const schema = appDomain.toInstantSchema()

export type AppSchema = typeof schema
export default schema

