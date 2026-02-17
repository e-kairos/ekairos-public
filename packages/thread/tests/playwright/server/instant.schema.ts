/**
 * Story workflow smoke InstantDB schema entrypoint.
 */

import { domain } from "@ekairos/domain";
import { threadDomain } from "@ekairos/thread";

const appDomain = domain("story-workflow-smoke")
  .includes(threadDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

const schema = appDomain.toInstantSchema();

export type AppSchema = typeof schema;
export default schema;
