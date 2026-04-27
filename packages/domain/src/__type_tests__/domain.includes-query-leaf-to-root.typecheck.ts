import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams } from "@instantdb/core";

// given: a transitive include chain organizations -> projects -> tasks with
// reverse labels for navigating back to the root.
const organizationsDomain = domain("includes-query-leaf-organizations").schema({
  entities: {
    organizations: i.entity({
      clerkOrgId: i.string().indexed().unique(),
    }),
  },
  links: {},
  rooms: {},
});

const projectsDomain = domain("includes-query-leaf-projects")
  .includes(organizationsDomain)
  .schema({
    entities: {
      projects: i.entity({
        name: i.string(),
      }),
    },
    links: {
      projectsOrganization: {
        forward: { on: "projects", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "projects" },
      },
    },
    rooms: {},
  });

const tasksDomain = domain("includes-query-leaf-tasks")
  .includes(projectsDomain)
  .schema({
    entities: {
      tasks: i.entity({
        title: i.string(),
      }),
    },
    links: {
      tasksProject: {
        forward: { on: "tasks", has: "one", label: "project" },
        reverse: { on: "projects", has: "many", label: "tasks" },
      },
    },
    rooms: {},
  });

type TasksSchema = DomainInstantSchema<typeof tasksDomain>;

// when: a query starts at the leaf entity and follows reverse labels back to
// the root entity.
const queryFromLeafToRoot = {
  tasks: {
    project: {
      organization: {},
    },
  },
} satisfies InstaQLParams<TasksSchema>;

// then: the merged schema preserves reverse query labels across included
// domains.
type _QueryFromLeafToRoot = typeof queryFromLeafToRoot;
