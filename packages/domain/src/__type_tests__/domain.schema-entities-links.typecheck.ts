import { domain, type DomainInstantSchema } from "..";
import { i } from "@instantdb/core";

// given: a task domain with one entity and one link to $users.
const tasksDomain = domain("schema-entities-links-tasks").schema({
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

// when: DomainInstantSchema exposes the schema bags.
type TasksSchema = DomainInstantSchema<typeof tasksDomain>;
type HasTaskEntity = "tasks" extends keyof TasksSchema["entities"] ? true : false;
type HasTaskOwnerLink = "tasksOwner" extends keyof TasksSchema["links"] ? true : false;

// then: both the entity and the link are present by their InstantDB keys.
const _hasTaskEntity: HasTaskEntity = true;
const _hasTaskOwnerLink: HasTaskOwnerLink = true;
