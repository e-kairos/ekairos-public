import { domain } from "@ekairos/domain";
import { threadDomain } from "@ekairos/thread/schema";

const appDomain = domain("thread-elements")
  .includes(threadDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export default appDomain;
