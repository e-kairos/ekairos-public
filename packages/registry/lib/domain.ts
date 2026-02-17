// import { domain } from "@ekairos/domain";
import { domain } from "../../domain";
import { registryDomain } from "./domain/registry/schema";

const appDomain = domain("app")
  .includes(registryDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

export default appDomain;
