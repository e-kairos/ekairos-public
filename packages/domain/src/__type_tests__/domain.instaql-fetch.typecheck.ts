import { domain, type DomainInstantSchema } from "..";
import { i, type InstantCoreDatabase, type InstaQLParams, type ValidQuery } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

type Expect<T extends true> = T;

// given: a domain with the same conceptual shape as the InstaQL docs:
// goals are related to todos, todos can be read back through the reverse
// goals label, and todos also has an owner relation so nested relation filters
// are covered. The schema is intentionally small so type errors point at the
// exact InstaQL feature being validated.
const instaqlFetchDomain = domain("instaql-fetch").schema({
  entities: {
    goals: i.entity({
      title: i.string().indexed(),
    }),
    todos: i.entity({
      title: i.string().indexed(),
      completed: i.boolean().indexed(),
    }),
    users: i.entity({
      email: i.string().indexed(),
    }),
  },
  links: {
    goalsTodos: {
      forward: { on: "goals", has: "many", label: "todos" },
      reverse: { on: "todos", has: "many", label: "goals" },
    },
    todosOwner: {
      forward: { on: "todos", has: "one", label: "owner" },
      reverse: { on: "users", has: "many", label: "todos" },
    },
  },
  rooms: {},
});

// when: we extract the InstantDB schema exposed by domain.
// then: every check in this file uses exactly the type InstantDB receives, not
// an internal ekairos/domain shape.
type FetchSchema = DomainInstantSchema<typeof instaqlFetchDomain>;

// given: FetchSchema has a goals entity.
// when: we express the most basic InstaQL query, a namespace with no options.
// then: `satisfies InstaQLParams` proves domain preserves the public contract
// recommended by the docs for declaring queries ahead of time.
const namespaceQuery = {
  goals: {},
} satisfies InstaQLParams<FetchSchema>;

// given: FetchSchema has goals and todos at the top level.
// when: we request both namespaces in a single query.
// then: InstantDB must accept the object as a typed multi-namespace query.
const multipleNamespacesQuery = {
  goals: {},
  todos: {},
} satisfies InstaQLParams<FetchSchema>;

// given: every InstantDB entity has an implicit id even when it is not declared
// in the domain schema.
// when: we filter goals by id using `$: { where }`.
// then: InstantDB validation must still recognize id as a valid field.
const filteredNamespaceQuery = {
  goals: {
    $: {
      where: {
        id: "goal_1",
      },
    },
  },
} satisfies InstaQLParams<FetchSchema>;

// given: goals has the forward `todos` link.
// when: we request goals with nested todos.
// then: the relation label must appear as a valid subquery key.
const associationQuery = {
  goals: {
    todos: {},
  },
} satisfies InstaQLParams<FetchSchema>;

// given: a query can combine `$` options and relation subqueries.
// when: we filter the goals namespace while requesting its todos.
// then: the intersection of options and links must remain compatible.
const filteredNamespaceWithAssociationsQuery = {
  goals: {
    $: {
      where: {
        id: "goal_1",
      },
    },
    todos: {},
  },
} satisfies InstaQLParams<FetchSchema>;

// given: InstantDB can filter an entity by values from related entities using
// dotted paths.
// when: we filter goals by `todos.title`.
// then: the schema composed by domain must preserve the link graph so ValidQuery
// can resolve the nested path.
const filterByAssociatedValuesQuery = {
  goals: {
    $: {
      where: {
        "todos.title": "Code a bunch",
      },
    },
    todos: {},
  },
} satisfies InstaQLParams<FetchSchema>;

// given: `$` options are also valid inside a nested relation.
// when: we filter the todos associated with each goal.
// then: InstantDB must validate the where clause against the link target entity.
const filterAssociationsQuery = {
  goals: {
    todos: {
      $: {
        where: {
          title: "Go on a run",
        },
      },
    },
  },
} satisfies InstaQLParams<FetchSchema>;

// given: the goalsTodos link also declares the reverse `goals` label.
// when: we navigate from todos back to goals.
// then: domain must preserve reverse relations because InstaQL queries use
// labels, not link names.
const inverseAssociationsQuery = {
  todos: {
    goals: {},
  },
} satisfies InstaQLParams<FetchSchema>;

declare const currentUserId: string | null;

// given: the docs allow deferring queries by passing null until parameters are
// available.
// when: we model a query that only exists when currentUserId is present.
// then: `InstaQLParams<FetchSchema> | null` remains representable without a
// domain-specific wrapper.
const deferredQuery: InstaQLParams<FetchSchema> | null = currentUserId
  ? {
      todos: {
        $: {
          where: {
            "owner.id": currentUserId,
          },
        },
      },
    }
  : null;

// given: `satisfies InstaQLParams` covers the public declaration surface, while
// `ValidQuery` covers the stricter validation used by InstantDB's real
// `db.query`, `subscribeQuery`, and `queryOnce` methods.
// when: we pass the complex cases through ValidQuery.
// then: each alias must resolve to true; if domain loses links or attrs, Expect
// fails at compile time.
type FilterByAssociatedValuesOk = typeof filterByAssociatedValuesQuery extends ValidQuery<
  typeof filterByAssociatedValuesQuery,
  FetchSchema
>
  ? true
  : false;
type FilterAssociationsOk = typeof filterAssociationsQuery extends ValidQuery<
  typeof filterAssociationsQuery,
  FetchSchema
>
  ? true
  : false;
type InverseAssociationsOk = typeof inverseAssociationsQuery extends ValidQuery<
  typeof inverseAssociationsQuery,
  FetchSchema
>
  ? true
  : false;

type _FilterByAssociatedValuesOk = Expect<FilterByAssociatedValuesOk>;
type _FilterAssociationsOk = Expect<FilterAssociationsOk>;
type _InverseAssociationsOk = Expect<InverseAssociationsOk>;

declare const adminDb: InstantAdminDatabase<FetchSchema, true>;
declare const coreDb: InstantCoreDatabase<FetchSchema, true>;

// given: the query objects above already satisfy the `InstaQLParams` shape.
// when: we pass them to `db.query`, which uses `ValidQuery` as the real
// constraint.
// then: the schema generated by domain behaves like a native InstantDB schema
// for the admin client.
void adminDb.query(namespaceQuery);
void adminDb.query(multipleNamespacesQuery);
void adminDb.query(filteredNamespaceQuery);
void adminDb.query(associationQuery);
void adminDb.query(filteredNamespaceWithAssociationsQuery);
void adminDb.query(filterByAssociatedValuesQuery);
void adminDb.query(filterAssociationsQuery);
void adminDb.query(inverseAssociationsQuery);

// given: a deferred query can be null before it is executed.
// when: the caller has narrowed it to a non-null value.
// then: TypeScript narrowing is enough to pass it to InstantDB without any
// extra domain API.
if (deferredQuery) {
  void adminDb.query(deferredQuery);
}

// given: queryOnce and subscribeQuery belong to the core client, not to domain.
// when: we instantiate their types with FetchSchema.
// then: domain does not lose one-shot fetch support or subscription result
// inference.
void coreDb.queryOnce(namespaceQuery);
coreDb.subscribeQuery(associationQuery, (resp) => {
  const goals = resp.data.goals;
  type Goal = (typeof goals)[number];
  type _GoalHasTodos = Expect<"todos" extends keyof Goal ? true : false>;
  void goals;
});
