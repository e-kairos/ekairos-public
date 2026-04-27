import { domain, type DomainInstantSchema } from "..";
import { i, type InstaQLParams } from "@instantdb/core";

// given: a transitive include chain organizations -> projects -> tasks.
const organizationsDomain = domain("includes-query-root-organizations").schema({
  entities: {
    organizations: i.entity({
      clerkOrgId: i.string().indexed().unique(),
    }),
  },
  links: {},
  rooms: {},
});

const projectsDomain = domain("includes-query-root-projects")
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

const tasksDomain = domain("includes-query-root-tasks")
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

// when: a query starts at the transitive root entity and follows links to the
// leaf entity.
const queryAcrossIncludedDomains = {
  organizations: {
    projects: {
      tasks: {},
    },
  },
} satisfies InstaQLParams<TasksSchema>;

// then: InstaQLParams accepts traversal across all included domains.
type _QueryAcrossIncludedDomains = typeof queryAcrossIncludedDomains;
