import { domain } from "..";
import { i } from "@instantdb/core";

// given: a builder-created domain result.
const builderDomain = domain("builder-result-shape").schema({
  entities: {
    builder_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

// when: consumers access runtime entity and link bags from the materialized
// result.
const builderEntities: Record<string, unknown> = builderDomain.entities;
const builderLinks: Record<string, unknown> = builderDomain.links;

// then: the public shape remains assignable to ordinary record-like consumers.
type _BuilderEntities = typeof builderEntities;
type _BuilderLinks = typeof builderLinks;
