import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLEntity } from "@instantdb/core";

// given: books includes authors through a one-to-many relation.
const authorsDomain = domain("entity-result-authors").schema({
  entities: {
    authors: i.entity({
      name: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const booksDomain = domain("entity-result-books")
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

// when: InstantDB helper types extract individual entities with and without
// relation subqueries.
type Book = InstaQLEntity<BooksSchema, "books">;
type Author = InstaQLEntity<BooksSchema, "authors">;
type BookWithAuthor = InstaQLEntity<BooksSchema, "books", { author: {} }>;
type AuthorWithBooks = InstaQLEntity<BooksSchema, "authors", { books: {} }>;

// then: every entity extraction remains valid over DomainInstantSchema.
type _Book = Book;
type _Author = Author;
type _BookWithAuthor = BookWithAuthor;
type _AuthorWithBooks = AuthorWithBooks;
