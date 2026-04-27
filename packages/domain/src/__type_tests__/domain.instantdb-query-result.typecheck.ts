import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLResult } from "@instantdb/core";

// given: books includes authors and exposes the author relation label.
const authorsDomain = domain("query-result-authors").schema({
  entities: {
    authors: i.entity({
      name: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const booksDomain = domain("query-result-books")
  .includes(authorsDomain)
  .schema({
    entities: {
      books: i.entity({
        title: i.string(),
      }),
    },
    links: {
      booksAuthor: {
        forward: { on: "books", has: "one", label: "author" },
        reverse: { on: "authors", has: "many", label: "books" },
      },
    },
    rooms: {},
  });

type BooksSchema = DomainInstantSchema<typeof booksDomain>;

// when: InstaQLResult infers the result shape for a relation query.
type BooksResult = InstaQLResult<BooksSchema, {
  books: {
    author: {};
  };
}>;

// then: the query result helper accepts the domain schema directly.
type _BooksResult = BooksResult;
