// Example: Migrating from manual instant.schema.ts to domain-based schema
// This shows how to convert your existing ekairos-web instant.schema.ts

import { i } from "@instantdb/core";
import { domain } from "../index";

// BEFORE: Manual schema with 400+ lines
// const _schema = i.schema({
//   entities: { /* 200+ lines of entities */ },
//   links: { /* 200+ lines of links */ },
//   rooms: { /* rooms */ },
// });

// AFTER: Domain-based schema - modular and maintainable

// Core domain - fundamental entities shared across all domains
const coreDomain = domain({
  name: "core",
  entities: {
    organizations: i.entity({
      clerkOrgId: i.string().indexed().unique(),
      name: i.string(),
      timezone: i.string().optional(),
    }),
  },
  links: {},
  rooms: {},
});

// Finance domain - all financial entities and operations
const financeDomain = domain("finance")
  .includes(coreDomain)
  .schema({
    entities: {
      transactions: i.entity({
        provider: i.string().indexed(),
        externalId: i.string().indexed(),
        amount: i.number(),
        currency: i.string().optional(),
        status: i.string().indexed(),
        description: i.string().optional(),
        createdAt: i.date().indexed(),
        updatedAt: i.date().indexed().optional(),
      }),
      payments: i.entity({
        provider: i.string().indexed(),
        externalPaymentId: i.string().indexed(),
        amount: i.number(),
        currency: i.string().optional(),
        status: i.string().indexed(),
        method: i.string().optional(),
        createdAt: i.date(),
      }),
    },
    links: {
      transactionOrganization: {
        forward: { on: "transactions", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "transactions" },
      },
      transactionUser: {
        forward: { on: "transactions", has: "one", label: "createdBy" },
        reverse: { on: "$users", has: "many", label: "transactions" },
      },
      transactionPayment: {
        forward: { on: "transactions", has: "one", label: "payment" },
        reverse: { on: "payments", has: "one", label: "transaction" },
      },
    },
    rooms: {},
  });

// Management domain - project and task management
const managementDomain = domain("management")
  .includes(coreDomain)
  .schema({
    entities: {
      projects: i.entity({
        name: i.string(),
        description: i.string().optional(),
        status: i.string(),
        createdAt: i.date(),
        updatedAt: i.date(),
      }),
      tasks: i.entity({
        title: i.string(),
        description: i.string().optional(),
        status: i.string(),
        priority: i.string().optional(),
        createdAt: i.date(),
        updatedAt: i.date(),
      }),
    },
    links: {
      projectOrganization: {
        forward: { on: "projects", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "projects" },
      },
      taskAssignee: {
        forward: { on: "tasks", has: "one", label: "assignee" },
        reverse: { on: "$users", has: "many", label: "assignedTasks" },
      },
      projectTasks: {
        forward: { on: "projects", has: "many", label: "tasks" },
        reverse: { on: "tasks", has: "one", label: "project" },
      },
    },
    rooms: {},
  });

// App domain - combines everything for the complete application
const appDomain = domain("app")
  .includes(coreDomain)      // Include core entities
  .includes(financeDomain)   // Include finance (transitively includes core)
  .includes(managementDomain) // Include management (transitively includes core)
  .schema({
    entities: {
      // App-specific entities
      app_settings: i.entity({
        key: i.string().unique().indexed(),
        value: i.any(),
        createdAt: i.date(),
        updatedAt: i.date(),
      }),
      notifications: i.entity({
        type: i.string(),
        message: i.string(),
        read: i.boolean().optional(),
        createdAt: i.date(),
      }),
      // Add all the other entities from your current schema here...
      // (locations, routes, items, etc.)
    },
    links: {
      // Core organization links (base entities available here)
      organizationMembers: {
        forward: { on: "organizations", has: "many", label: "members" },
        reverse: { on: "$users", has: "many", label: "organizations" },
      },
      // App-specific links
      settingsOrganization: {
        forward: { on: "app_settings", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "settings" },
      },
      notificationUser: {
        forward: { on: "notifications", has: "one", label: "user" },
        reverse: { on: "$users", has: "many", label: "notifications" },
      },
      // Cross-domain references work automatically
      notificationTransaction: {
        forward: { on: "notifications", has: "one", label: "relatedTransaction" },
        reverse: { on: "transactions", has: "many", label: "notifications" },
      },
      notificationProject: {
        forward: { on: "notifications", has: "one", label: "relatedProject" },
        reverse: { on: "projects", has: "many", label: "notifications" },
      },
      // Add all the other links from your current schema here...
      // (organization links, finance links, etc.)
    },
    rooms: {
      // Add rooms from your current schema
    },
  });

// FINAL SCHEMA: Direct compatibility with InstantDB
export const instantSchema = i.schema(appDomain.toInstantSchema());

// This replaces your entire 400+ line manual schema with:
// 1. Modular, maintainable domains
// 2. Automatic cross-domain references
// 3. No manual duplication of base entities
// 4. Full type safety

// Type exports for TypeScript
export type AppSchema = typeof instantSchema;
export default instantSchema;

/*
MIGRATION BENEFITS:

1. 📦 Modularity: Each domain is independent and reusable
2. 🔗 Type Safety: Cross-domain links are fully validated
3. 🚀 Maintainability: Changes are localized to relevant domains
4. ⚡ Performance: Only load domains you need in specific contexts
5. 🔄 Compatibility: Drop-in replacement for existing i.schema() calls
6. 🎯 Clarity: Intent is clear - domains explicitly include their dependencies

NEXT STEPS:
1. Break down your current instant.schema.ts into logical domains
2. Use .includes() to establish dependencies between domains
3. Replace manual schema with domain.toInstantSchema()
4. Test thoroughly - all existing functionality should work identically
*/
