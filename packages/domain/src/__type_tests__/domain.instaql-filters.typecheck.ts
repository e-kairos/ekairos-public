import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams, type ValidQuery } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

type Expect<T extends true> = T;

// given: a domain with indexed, checked attrs, which InstantDB requires for
// comparison operators, ordering, and like/ilike searches. It also includes
// goals <-> todos to cover dotted-path relation filters.
const instaqlFiltersDomain = domain("instaql-filters").schema({
  entities: {
    goals: i.entity({
      title: i.string().indexed(),
    }),
    todos: i.entity({
      title: i.string().indexed(),
      completed: i.boolean().indexed(),
      timeEstimateHours: i.number().indexed(),
      dueAt: i.number().optional().indexed(),
      location: i.string().optional().indexed(),
    }),
  },
  links: {
    goalsTodos: {
      forward: { on: "goals", has: "many", label: "todos" },
      reverse: { on: "todos", has: "many", label: "goals" },
    },
  },
  rooms: {},
});

// when: we obtain the schema consumed by InstantDB.
// then: these tests do not depend on internal helper types; they verify the
// external compatibility of DomainInstantSchema.
type FiltersSchema = DomainInstantSchema<typeof instaqlFiltersDomain>;

// given: todos has a local boolean attr and a reverse link to goals.
// when: we combine conditions over the local attr and the `goals.title` dotted
// path.
// then: InstantDB must treat both as valid implicit AND conditions.
const multipleWhereConditionsQuery = {
  todos: {
    $: {
      where: {
        completed: true,
        "goals.title": "Get promoted!",
      },
    },
  },
} satisfies InstaQLParams<FiltersSchema>;

// given: the docs support explicit `and` and `or` combinators.
// when: we mix two relation filters in `and` with local alternatives in `or`.
// then: the where type must accept arrays of complete where clauses.
const andOrQuery = {
  goals: {
    $: {
      where: {
        and: [{ "todos.title": "Drink protein" }, { "todos.title": "Go on a run" }],
        or: [{ title: "Get fit!" }, { title: "Get promoted!" }],
      },
    },
  },
} satisfies InstaQLParams<FiltersSchema>;

// given: advanced operators are defined by attribute type: strings accept
// `$like/$ilike`, numbers accept comparisons, and optional attrs accept
// `$isNull`.
// when: we exercise all of those operators in one query.
// then: DomainInstantSchema must preserve InstantDB's required/optional,
// indexed, and value-type metadata.
const operatorQuery = {
  todos: {
    $: {
      where: {
        title: {
          $in: ["Code a bunch", "Review PRs"],
          $ne: "Archived",
          $like: "%Code%",
          $ilike: "%code%",
        },
        timeEstimateHours: {
          $gt: 1,
          $gte: 1,
          $lt: 100,
          $lte: 100,
        },
        dueAt: {
          $lte: 1_735_344_000_000,
        },
        location: {
          $isNull: false,
        },
      },
    },
  },
} satisfies InstaQLParams<FiltersSchema>;

// given: InstantDB also allows `$like/$ilike` in relation filters.
// when: we use string operators over `todos.title` from goals.
// then: dotted-path resolution must reach the todos title attr and preserve its
// string operators.
const nestedLikeQuery = {
  goals: {
    $: {
      where: {
        "todos.title": {
          $like: "%standup%",
          $ilike: "%stand%",
        },
      },
    },
  },
} satisfies InstaQLParams<FiltersSchema>;

// given: the queries above pass the public `InstaQLParams` shape.
// when: we validate them against `ValidQuery`, the strict constraint used by
// InstantDB's real methods.
// then: each case must resolve to true; if domain incorrectly degrades attrs or
// links to any, these assertions fail.
type MultipleWhereConditionsOk = typeof multipleWhereConditionsQuery extends ValidQuery<
  typeof multipleWhereConditionsQuery,
  FiltersSchema
>
  ? true
  : false;
type AndOrOk = typeof andOrQuery extends ValidQuery<typeof andOrQuery, FiltersSchema> ? true : false;
type OperatorsOk = typeof operatorQuery extends ValidQuery<typeof operatorQuery, FiltersSchema> ? true : false;
type NestedLikeOk = typeof nestedLikeQuery extends ValidQuery<typeof nestedLikeQuery, FiltersSchema> ? true : false;

type _MultipleWhereConditionsOk = Expect<MultipleWhereConditionsOk>;
type _AndOrOk = Expect<AndOrOk>;
type _OperatorsOk = Expect<OperatorsOk>;
type _NestedLikeOk = Expect<NestedLikeOk>;

declare const db: InstantAdminDatabase<FiltersSchema, true>;

// given: db.query is the admin runtime API that receives ValidQuery.
// when: we send the documented filter shapes with the domain schema.
// then: each call must compile exactly as it would with a hand-written
// InstantDB schema.
void db.query(multipleWhereConditionsQuery);
void db.query(andOrQuery);
void db.query(operatorQuery);
void db.query(nestedLikeQuery);

// given: todos does not have an `unknowable` attribute.
// when: we try to filter by that field.
// then: the expected error confirms domain did not make InstaQL more permissive
// while wrapping the schema.
void db.query({
  todos: {
    $: {
      where: {
        // @ts-expect-error unknown where fields must stay rejected by InstantDB ValidQuery
        unknowable: "value",
      },
    },
  },
});
