import { domain, configureDomainDocLoader } from "./index.js";
import { i } from "@instantdb/core";

type TestFn = () => void | Promise<void>;

function test(name: string, fn: TestFn) {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>)
        .then(() => console.log(`[ok] ${name}`))
        .catch((err) =>
          console.log(`[fail] ${name}: ${err?.message || String(err)}`)
        );
      return;
    }
    console.log(`[ok] ${name}`);
  } catch (error: any) {
    console.log(`[fail] ${name}: ${error?.message || String(error)}`);
  }
}

function expect(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const rootDoc = `# domain: root
Type: platform
Focus: testing

## Overview
ROOT DOMAIN DOC

## Subdomains
### alpha
ALPHA FROM ROOT

### beta
BETA FROM ROOT
`;

const alphaDoc = `# domain: alpha

## Overview
ALPHA DOMAIN DOC
`;

const betaDoc = `# domain: beta

## Overview
BETA DOMAIN DOC
`;

configureDomainDocLoader(({ scope, meta }) => {
  if (scope === "root") {
    return { doc: rootDoc, docPath: "DOMAIN.md" };
  }
  if (meta?.name === "alpha") {
    return { doc: alphaDoc, docPath: "alpha/DOMAIN.md" };
  }
  if (meta?.name === "beta") {
    return { doc: betaDoc, docPath: "beta/DOMAIN.md" };
  }
  return null;
});

const alphaDomain = domain("alpha").schema({
  entities: { alpha_items: i.entity({ name: i.string() }) },
  links: {},
  rooms: {},
});

const betaDomain = domain("beta").schema({
  entities: { beta_items: i.entity({ title: i.string() }) },
  links: {},
  rooms: {},
});

const rootDomain = domain("root")
  .includes(alphaDomain)
  .includes(betaDomain)
  .schema({
    entities: { root_items: i.entity({ value: i.string() }) },
    links: {},
    rooms: {},
  });

console.log("Testing domain.context() and domain.contextString()");

test("context() returns root + registry docs", () => {
  const ctx = rootDomain.context();
  expect(ctx.name === "root", "root name should be set");
  expect(Boolean(ctx.doc), "root doc should be present");
  expect(ctx.registry.length === 2, "registry should include two subdomains");
  const names = ctx.registry.map((entry) => entry.name).sort();
  expect(names.join(",") === "alpha,beta", "registry names should match");
  const alpha = ctx.registry.find((entry) => entry.name === "alpha");
  const beta = ctx.registry.find((entry) => entry.name === "beta");
  expect(Boolean(alpha?.doc), "alpha doc should be present");
  expect(Boolean(beta?.doc), "beta doc should be present");
});

test("contextString() includes docs", () => {
  const str = rootDomain.contextString();
  expect(str.includes("ROOT DOMAIN DOC"), "root doc missing in string");
  expect(str.includes("ALPHA DOMAIN DOC"), "alpha doc missing in string");
  expect(str.includes("BETA DOMAIN DOC"), "beta doc missing in string");
});

test("context(includeSchemas:false) omits schema", () => {
  const ctx = rootDomain.context({ includeSchemas: false });
  expect(!("schema" in ctx) || ctx.schema === undefined, "schema should be omitted");
  const alpha = ctx.registry.find((entry) => entry.name === "alpha");
  expect(!alpha?.schema, "alpha schema should be omitted");
});
