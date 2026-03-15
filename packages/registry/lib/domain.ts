import { domain } from "@ekairos/domain";
import { registryDomain } from "./domain/registry/schema";
import { eventsDomain } from "@ekairos/events/schema";

const appDomain = domain("app")
  .includes(registryDomain)
  .includes(eventsDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export default appDomain;
