/**
 * Story workflow smoke InstantDB schema entrypoint.
 */

import { domain } from "@ekairos/domain";
import { eventsDomain } from "@ekairos/events";

const appDomain = domain("story-workflow-smoke")
  .includes(eventsDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

const schema = appDomain.toInstantSchema();

export type AppSchema = typeof schema;
export default schema;
