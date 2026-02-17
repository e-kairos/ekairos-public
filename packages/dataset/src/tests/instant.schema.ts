/**
 * Test-only InstantDB schema entrypoint.
 *
 * PURPOSE (exclusive):
 * - Used to run `instant-cli` schema push for the dataset test environment.
 * - This is NOT used by the app runtime, stories, or tools directly.
 *
 * Why this exists:
 * - Dataset sandbox steps persist `sandbox_sandboxes` via `@ekairos/sandbox`.
 * - Dataset flows persist `dataset_*` entities via `@ekairos/dataset`.
 * - The Instant app used by tests must have both domains applied.
 *
 * Env:
 * - Put a `.env.local` next to this folder (or ensure your CLI loads it) with:
 *   - NEXT_PUBLIC_INSTANT_APP_ID
 *   - INSTANT_APP_ADMIN_TOKEN
 */

import { domain } from "@ekairos/domain"
import { sandboxDomain } from "@ekairos/sandbox"
import { threadDomain } from "@ekairos/thread"
import { datasetDomain } from "../schema"

// Compose what tests need:
// - dataset + sandbox (for FileParseStory + sandbox steps)
// - story (InstantStore persistence used by @ekairos/thread)
const appDomain = domain("dataset-tests")
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .includes(threadDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  })

const schema = appDomain.toInstantSchema()

export type AppSchema = typeof schema
export default schema

