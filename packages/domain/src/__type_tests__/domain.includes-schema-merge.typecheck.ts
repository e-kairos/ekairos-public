import { domain, type DomainInstantSchema } from "..";
import { i } from "@instantdb/core";

// given: organizations -> projects -> tasks are composed through transitive
// includes.
const organizationsDomain = domain("includes-organizations").schema({
  entities: {
    organizations: i.entity({
      clerkOrgId: i.string().indexed().unique(),
      timezone: i.string().optional(),
    }),
  },
  links: {},
  rooms: {},
});

const projectsDomain = domain("includes-projects")
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

const tasksDomain = domain("includes-tasks")
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

// when: the leaf domain is converted to an InstantDB schema type.
type TasksSchema = DomainInstantSchema<typeof tasksDomain>;
type TasksSchemaEntities = TasksSchema["entities"];
type TasksSchemaLinks = TasksSchema["links"];

// then: transitive entities and links are all present in the merged schema.
type HasOrganizations = "organizations" extends keyof TasksSchemaEntities ? true : false;
type HasProjects = "projects" extends keyof TasksSchemaEntities ? true : false;
type HasTasks = "tasks" extends keyof TasksSchemaEntities ? true : false;
type HasProjectOrganizationLink = "projectsOrganization" extends keyof TasksSchemaLinks ? true : false;
type HasTasksProjectLink = "tasksProject" extends keyof TasksSchemaLinks ? true : false;

const _hasOrganizations: HasOrganizations = true;
const _hasProjects: HasProjects = true;
const _hasTasks: HasTasks = true;
const _hasProjectOrganizationLink: HasProjectOrganizationLink = true;
const _hasTasksProjectLink: HasTasksProjectLink = true;

// given: one included domain owns the public attrs for an entity and the local
// schema adds backend-only attrs to the same entity.
const publicSandboxDomain = domain("includes-public-sandbox").schema({
  entities: {
    sandboxes: i.entity({
      sandboxUrl: i.string().optional(),
      status: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

const fullSandboxDomain = domain("includes-full-sandbox")
  .includes(publicSandboxDomain)
  .schema({
    entities: {
      sandboxes: i.entity({
        externalSandboxId: i.string().optional().indexed(),
        providerConfig: i.json().optional(),
      }),
    },
    links: {},
    rooms: {},
  });

// then: the merged schema type exposes attrs from both definitions.
type FullSandboxSchema = DomainInstantSchema<typeof fullSandboxDomain>;
type FullSandboxAttrs = FullSandboxSchema["entities"]["sandboxes"]["attrs"];
type HasSandboxUrl = "sandboxUrl" extends keyof FullSandboxAttrs ? true : false;
type HasSandboxStatus = "status" extends keyof FullSandboxAttrs ? true : false;
type HasExternalSandboxId = "externalSandboxId" extends keyof FullSandboxAttrs ? true : false;
type HasProviderConfig = "providerConfig" extends keyof FullSandboxAttrs ? true : false;

const _hasSandboxUrl: HasSandboxUrl = true;
const _hasSandboxStatus: HasSandboxStatus = true;
const _hasExternalSandboxId: HasExternalSandboxId = true;
const _hasProviderConfig: HasProviderConfig = true;
