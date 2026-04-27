import { i } from "@instantdb/core";

import {
  EkairosRuntime,
  type RuntimeForDomain,
  domain,
} from "../index";

type Env = Record<string, unknown>;
type Db = { runtimeCall: number };

// given: two domains with the same schema but different domain names.
const sameSchemaOne = domain("same-schema-one").schema({
  entities: {
    shared_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const sameSchemaTwo = domain("same-schema-two").schema({
  entities: {
    shared_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const sameSchemaApp = domain("same-schema-app")
  .includes(sameSchemaOne)
  .schema({ entities: {}, links: {}, rooms: {} });

class SameSchemaRuntime extends EkairosRuntime<Env, typeof sameSchemaApp, Db> {
  protected getDomain() {
    return sameSchemaApp;
  }

  protected resolveDb() {
    return { runtimeCall: 3 };
  }
}

function requiresSameSchemaTwo<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: RuntimeForDomain<Runtime, typeof sameSchemaTwo>,
) {
  return runtime;
}

const sameSchemaRuntime = new SameSchemaRuntime({});

// when: code asks for sameSchemaTwo using a runtime that includes only
// sameSchemaOne.
// then: schema compatibility alone is rejected because runtime compatibility is
// based on domain name plus schema.
// @ts-expect-error same schema is not enough when the domain name differs
requiresSameSchemaTwo(sameSchemaRuntime);
