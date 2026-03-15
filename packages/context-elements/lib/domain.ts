import { domain } from "@ekairos/domain";
import { eventsDomain } from "@ekairos/events/schema";

const appDomain = domain("context-elements")
  .includes(eventsDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export default appDomain;
