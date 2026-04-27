import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";

// given: a task domain whose tasks entity has an owner relation.
const tasksDomain = domain("schema-query-shape-tasks").schema({
  entities: {
    tasks: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
    }),
  },
  links: {
    tasksOwner: {
      forward: { on: "tasks", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "tasks" },
    },
  },
  rooms: {},
});

type TasksSchema = DomainInstantSchema<typeof tasksDomain>;

// when: a query uses the owner relation label.
const taskQuery = {
  tasks: {
    owner: {},
  },
} satisfies InstaQLParams<TasksSchema>;

type _TaskQuery = typeof taskQuery;

declare const db: InstantAdminDatabase<TasksSchema, true>;

// then: db.query accepts the valid relation query and rejects an invalid entity
// name for the same schema.
void db.query(taskQuery);

void db.query({
  // @ts-expect-error typo in top-level entity must stay rejected
  taskz: {},
});
