import { domain, type DomainInstantSchema } from "..";
import { i } from "@instantdb/core";

type Expect<T extends true> = T;

// given: a root domain that includes an entity from a source domain and defines
// one local entity.
const sourceDomain = domain("dx-schema-source").schema({
  entities: {
    source_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const rootDomain = domain("dx-schema-root")
  .includes(sourceDomain)
  .schema({
    entities: {
      root_items: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  });

// when: DomainInstantSchema extracts the InstantDB schema type from the domain.
type RootSchema = DomainInstantSchema<typeof rootDomain>;
type RootSchemaEntities = keyof RootSchema["entities"];

// then: both included and local entities are visible to InstantDB helper types.
type _RootSchemaIncludesSourceEntity = Expect<"source_items" extends RootSchemaEntities ? true : false>;
type _RootSchemaIncludesRootEntity = Expect<"root_items" extends RootSchemaEntities ? true : false>;
