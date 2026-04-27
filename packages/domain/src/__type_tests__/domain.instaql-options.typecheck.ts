import { domain, type DomainInstantSchema } from "..";
import { i, type InstantCoreDatabase, type InstaQLParams, type ValidQuery } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

type Expect<T extends true> = T;
type Cursor = [string, string, unknown, number];

// given: a domain with projects -> todos and indexed attrs to exercise
// pagination, order, and fields at both top-level and nested query positions.
// `dueAt` is optional to cover comparisons against a common date-like field.
const instaqlOptionsDomain = domain("instaql-options").schema({
  entities: {
    projects: i.entity({
      name: i.string().indexed(),
    }),
    todos: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
      dueAt: i.number().optional().indexed(),
    }),
  },
  links: {
    projectsTodos: {
      forward: { on: "projects", has: "many", label: "todos" },
      reverse: { on: "todos", has: "one", label: "project" },
    },
  },
  rooms: {},
});

// when: we convert the domain into the schema InstantDB sees.
// then: every InstaQL option is validated against this type, not against the
// original builder shape.
type OptionsSchema = DomainInstantSchema<typeof instaqlOptionsDomain>;

declare const cursor: Cursor;

// given: InstantDB supports offset pagination on top-level namespaces.
// when: we request a todos page with limit and offset.
// then: both `InstaQLParams` and `ValidQuery` must accept the options together.
const limitOffsetQuery = {
  todos: {
    $: {
      limit: 10,
      offset: 20,
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: InstantDB models cursors as opaque tuples returned in pageInfo.
// when: we request the next page with `first` and `after`.
// then: the domain type must accept the same cursor shape InstantDB expects.
const forwardCursorQuery = {
  todos: {
    $: {
      first: 10,
      after: cursor,
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: backward pagination uses the starting cursor from pageInfo.
// when: we request previous items with `last` and `before`.
// then: the domain schema must not alter the typed cursor shape.
const backwardCursorQuery = {
  todos: {
    $: {
      last: 10,
      before: cursor,
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: `order` allows serverCreatedAt and indexed checked attributes.
// when: we combine where, limit, and order by dueAt.
// then: InstantDB must recognize dueAt as an orderable attr from the domain
// schema.
const orderQuery = {
  todos: {
    $: {
      limit: 10,
      where: {
        dueAt: {
          $gt: 0,
        },
      },
      order: {
        dueAt: "asc",
        serverCreatedAt: "desc",
      },
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: the docs allow order inside nested namespaces.
// when: we order todos inside each project.
// then: validation must resolve the nested `$` options against the link target
// entity, not projects.
const nestedOrderQuery = {
  projects: {
    todos: {
      $: {
        order: {
          dueAt: "asc",
        },
      },
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: `fields` reduces returned fields and also works in relations.
// when: we select project fields and a different set of todo fields.
// then: the type must limit fields to ids and real attrs for each entity.
const selectedFieldsQuery = {
  projects: {
    $: {
      fields: ["id", "name"],
    },
    todos: {
      $: {
        fields: ["id", "status"],
      },
    },
  },
} satisfies InstaQLParams<OptionsSchema>;

// given: `InstaQLParams` proves the declarative surface and `ValidQuery` proves
// the execution constraint.
// when: we pass every documented option through strict validation.
// then: all cases must resolve to true, confirming domain does not lose query
// options while encapsulating InstantDB.
type LimitOffsetOk = typeof limitOffsetQuery extends ValidQuery<typeof limitOffsetQuery, OptionsSchema>
  ? true
  : false;
type ForwardCursorOk = typeof forwardCursorQuery extends ValidQuery<typeof forwardCursorQuery, OptionsSchema>
  ? true
  : false;
type BackwardCursorOk = typeof backwardCursorQuery extends ValidQuery<typeof backwardCursorQuery, OptionsSchema>
  ? true
  : false;
type OrderOk = typeof orderQuery extends ValidQuery<typeof orderQuery, OptionsSchema> ? true : false;
type NestedOrderOk = typeof nestedOrderQuery extends ValidQuery<typeof nestedOrderQuery, OptionsSchema>
  ? true
  : false;
type SelectedFieldsOk = typeof selectedFieldsQuery extends ValidQuery<typeof selectedFieldsQuery, OptionsSchema>
  ? true
  : false;

type _LimitOffsetOk = Expect<LimitOffsetOk>;
type _ForwardCursorOk = Expect<ForwardCursorOk>;
type _BackwardCursorOk = Expect<BackwardCursorOk>;
type _OrderOk = Expect<OrderOk>;
type _NestedOrderOk = Expect<NestedOrderOk>;
type _SelectedFieldsOk = Expect<SelectedFieldsOk>;

declare const adminDb: InstantAdminDatabase<OptionsSchema, true>;
declare const coreDb: InstantCoreDatabase<OptionsSchema, true>;

// given: the admin client uses the same ValidQuery constraint we need to
// preserve.
// when: we execute every option query against db.query.
// then: domain behaves like a native InstantDB schema for pagination, order,
// and fields.
void adminDb.query(limitOffsetQuery);
void adminDb.query(forwardCursorQuery);
void adminDb.query(backwardCursorQuery);
void adminDb.query(orderQuery);
void adminDb.query(nestedOrderQuery);
void adminDb.query(selectedFieldsQuery);

// given: queryOnce returns data and pageInfo for the same paginated query.
// when: we call queryOnce with the domain schema and read pageInfo.todos.
// then: result inference and the pageInfo structure are preserved.
void coreDb.queryOnce(limitOffsetQuery).then((resp) => {
  const pageInfo = resp.pageInfo.todos;
  const data = resp.data.todos;
  void pageInfo.endCursor;
  void data;
});
