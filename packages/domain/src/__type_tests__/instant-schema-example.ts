// Example: instant.schema.ts using domain builder
// This shows how to build a complete InstantDB schema using domains

import { i } from "@instantdb/core";
import { domain } from "../index";

// 1. Base/Core domain - defines fundamental entities
const coreDomain = domain({
  name: "core",
  entities: {
    organizations: i.entity({
      clerkOrgId: i.string().indexed().unique(),
      name: i.string(),
      timezone: i.string().optional(),
      createdAt: i.date(),
    }),
  },
  links: {},
  rooms: {},
});

// 2. Finance domain - includes core entities for financial operations
const financeDomain = domain("finance")
  .includes(coreDomain) // Include core entities (orgs, users) for cross-references
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
      // Cross-reference to organizations from coreDomain
      transactionOrganization: {
        forward: { on: "transactions", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "transactions" },
      },
      // Cross-reference to users (base entity, automatically available)
      transactionUser: {
        forward: { on: "transactions", has: "one", label: "createdBy" },
        reverse: { on: "$users", has: "many", label: "transactions" },
      },
      // Base entities are automatically available
      paymentFiles: {
        forward: { on: "payments", has: "many", label: "$files" },
        reverse: { on: "$files", has: "one", label: "payment" },
      },
      transactionPayment: {
        forward: { on: "transactions", has: "one", label: "payment" },
        reverse: { on: "payments", has: "one", label: "transaction" },
      },
    },
    rooms: {},
  });

// 3. Management domain - includes core entities for project management
const managementDomain = domain("management")
  .includes(coreDomain) // Include core entities (orgs, users)
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
      // Cross-reference to organizations from coreDomain
      projectOrganization: {
        forward: { on: "projects", has: "one", label: "organization" },
        reverse: { on: "organizations", has: "many", label: "projects" },
      },
      // Cross-reference to users (base entity, automatically available)
      taskAssignee: {
        forward: { on: "tasks", has: "one", label: "assignee" },
        reverse: { on: "$users", has: "many", label: "assignedTasks" },
      },
      taskCreator: {
        forward: { on: "tasks", has: "one", label: "creator" },
        reverse: { on: "$users", has: "many", label: "createdTasks" },
      },
      // Project-Task relationship
      projectTasks: {
        forward: { on: "projects", has: "many", label: "tasks" },
        reverse: { on: "tasks", has: "one", label: "project" },
      },
      // Base entities automatically available
      projectFiles: {
        forward: { on: "projects", has: "many", label: "$files" },
        reverse: { on: "$files", has: "one", label: "project" },
      },
    },
    rooms: {},
  });

// 4. App domain - combines all domains for the complete application schema
const appDomain = domain("app")
  .includes(coreDomain)        // ✅ Include core domain
  .includes(financeDomain)     // ✅ Include finance domain
  .includes(managementDomain)  // ✅ Include management domain
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
    },
  links: {
    // Cross-references to all included domains
    organizationMembers: {
      forward: { on: "organizations", has: "many", label: "members" },
      reverse: { on: "$users", has: "many", label: "organizations" },
    },
    settingsOrganization: {
      forward: { on: "app_settings", has: "one", label: "organization" },
      reverse: { on: "organizations", has: "many", label: "settings" },
    },
    notificationUser: {
      forward: { on: "notifications", has: "one", label: "user" },
      reverse: { on: "$users", has: "many", label: "notifications" },
    },
    // Can reference entities from transitively included domains
    notificationTransaction: {
      forward: { on: "notifications", has: "one", label: "relatedTransaction" },
      reverse: { on: "transactions", has: "many", label: "notifications" },
    },
    notificationProject: {
      forward: { on: "notifications", has: "one", label: "relatedProject" },
      reverse: { on: "projects", has: "many", label: "notifications" },
    },
  },
    rooms: {},
  });

// FINAL SCHEMA: Complete InstantDB schema using domain toInstantSchema()
// This would be in your instant.schema.ts file:
const instantSchema = appDomain.toInstantSchema(); // That's it!

// Type exports for TypeScript (in your actual instant.schema.ts)
type AppSchema = typeof instantSchema;
export default instantSchema;

/*
USAGE NOTES:

1. When you .includes() a domain, you get ALL its entities transitively:
   - appDomain.includes(coreDomain) → gets core entities
   - appDomain.includes(financeDomain) → gets finance + core entities (transitive)
   - appDomain.includes(managementDomain) → gets management + core entities (transitive)

2. Base entities ($users, $files) are automatically included in ALL domains

3. Cross-domain links work automatically - you can reference entities from included domains

4. toInstantSchema() returns the complete InstantDB schema directly:
   - domain.toInstantSchema() ✅ Returns ready-to-use schema
   - No need to wrap with i.schema() or manual spreading

5. No manual duplication of base entities or transitive dependencies needed

6. Anywhere you need an InstantDB schema object, you can use domain.toInstantSchema()
*/
