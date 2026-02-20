// import { domain } from "@ekairos/domain";
import { domain } from "../../domain";
import { registryDomain } from "./domain/registry/schema";
import { threadDomain } from "@ekairos/thread";

const appDomain = domain("app")
  .includes(registryDomain)
  .includes(threadDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export default appDomain;
