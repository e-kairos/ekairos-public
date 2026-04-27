import { domain } from "..";
import { i } from "@instantdb/core";

// given: two classic object-style domains, which predate the builder API.
const classicDomain = domain({
  name: "classic-compose-base",
  entities: {
    classic_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const extraDomain = domain({
  name: "classic-compose-extra",
  entities: {
    extra_items: i.entity({
      value: i.number(),
    }),
  },
  links: {},
  rooms: {},
});

// when: the old compose API combines both domains.
const composedDomain = classicDomain.compose(extraDomain);
type ComposedSchema = ReturnType<typeof composedDomain.schema>;
type ComposedEntities = ComposedSchema["entities"];

// then: the composed schema exposes entities from both classic domains.
type HasClassicItems = "classic_items" extends keyof ComposedEntities ? true : false;
type HasExtraItems = "extra_items" extends keyof ComposedEntities ? true : false;

const _hasClassicItems: HasClassicItems = true;
const _hasExtraItems: HasExtraItems = true;
