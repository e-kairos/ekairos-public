import {
  domain,
  type DomainNameOf,
  type IncludedDomainNamesOf,
} from "..";
import { i } from "@instantdb/core";

type Expect<T extends true> = T;

// given: a root domain that includes a source domain.
const sourceDomain = domain("dx-source").schema({
  entities: {
    source_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const rootDomain = domain("dx-root")
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

// when: DX helper types extract the literal domain names.
type SourceName = DomainNameOf<typeof sourceDomain>;
type RootName = DomainNameOf<typeof rootDomain>;
type RootIncludedNames = IncludedDomainNamesOf<typeof rootDomain>;

// then: literal names are preserved and included names are transitive enough for
// runtime compatibility checks.
type _SourceNameIsLiteral = Expect<SourceName extends "dx-source" ? true : false>;
type _RootNameIsLiteral = Expect<RootName extends "dx-root" ? true : false>;
type _RootIncludesItself = Expect<"dx-root" extends RootIncludedNames ? true : false>;
type _RootIncludesSource = Expect<"dx-source" extends RootIncludedNames ? true : false>;
type _RootDoesNotIncludeOther = Expect<"dx-other" extends RootIncludedNames ? false : true>;
