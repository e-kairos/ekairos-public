import { i } from "@instantdb/core";

import {
  EkairosRuntime,
  type RuntimeForDomain,
  domain,
} from "../index";

type Env = Record<string, unknown>;
type Db = { runtimeCall: number };

// given: B and C both include A, but neither includes the other.
const domainA = domain("domain-a").schema({
  entities: {
    domain_a_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const domainB = domain("domain-b")
  .includes(domainA)
  .schema({
    entities: {
      domain_b_items: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  });

const domainC = domain("domain-c")
  .includes(domainA)
  .schema({
    entities: {
      domain_c_items: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  });

class RuntimeB extends EkairosRuntime<Env, typeof domainB, Db> {
  protected getDomain() {
    return domainB;
  }

  protected resolveDb() {
    return { runtimeCall: 1 };
  }
}

class RuntimeC extends EkairosRuntime<Env, typeof domainC, Db> {
  protected getDomain() {
    return domainC;
  }

  protected resolveDb() {
    return { runtimeCall: 2 };
  }
}

function requiresA<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: RuntimeForDomain<Runtime, typeof domainA>,
) {
  return runtime;
}

function requiresB<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: RuntimeForDomain<Runtime, typeof domainB>,
) {
  return runtime;
}

function requiresC<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: RuntimeForDomain<Runtime, typeof domainC>,
) {
  return runtime;
}

const runtimeB = new RuntimeB({});
const runtimeC = new RuntimeC({});

// when: code asks for runtime compatibility with included and non-included
// domains.
requiresA(runtimeB);
requiresA(runtimeC);
requiresB(runtimeB);
requiresC(runtimeC);
runtimeB.use(domainA);
runtimeC.use(domainA);

// then: shared subdomain A is accepted transitively, while sibling domains B
// and C are not interchangeable.
// @ts-expect-error domain-c includes domain-a, not domain-b
requiresB(runtimeC);
// @ts-expect-error domain-b includes domain-a, not domain-c
requiresC(runtimeB);
// @ts-expect-error runtime.use requires the requested domain name transitively
runtimeC.use(domainB);
