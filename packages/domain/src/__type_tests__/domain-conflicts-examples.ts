// =====================================================================================
// ⚠️  DOMAIN CONFLICTS AND EDGE CASES
// =====================================================================================
// This file demonstrates scenarios where entity name conflicts can occur
// and how the domain builder handles them.

import { i } from "@instantdb/core";
import { domain } from "../index";

/*
// =====================================================================================
// ❌ SCENARIO 1: Entity Name Conflicts (Silent Overwrites)
// =====================================================================================

// Problem: Two domains define entities with the same name but different structures

const domainA = domain({
  entities: {
    users: i.entity({
      name: i.string(),        // Domain A version
      email: i.string(),
      createdAt: i.date(),
    }),
  },
  links: {},
  rooms: {},
});

const domainB = domain("b")
  .includes(domainA)
  .schema({
    entities: {
      users: i.entity({         // ❌ CONFLICT! Same name as domainA
        username: i.string(),   // Different fields
        age: i.number(),
        lastLogin: i.date(),
      }),
    },
    links: {
      // This link might break if it expects domainA.users fields
      userPosts: {
        forward: { on: "users", has: "many", label: "posts" },
        reverse: { on: "posts", has: "one", label: "author" },
      },
    },
    rooms: {},
  });

// RESULT: domainB.users overwrites domainA.users silently
// - domainB.toInstantSchema() only has domainB's version of users
// - Any code expecting domainA.users fields will break
// - No compile-time warning about this conflict

// =====================================================================================
// ❌ SCENARIO 2: Circular Dependencies
// =====================================================================================

// Problem: Domains trying to include each other creates infinite loops

const teamDomain = domain("teams");
const projectDomain = domain("projects")
  .includes(teamDomain)  // projects needs teams
  .schema({
    entities: {
      projects: i.entity({
        name: i.string(),
        teamId: i.string(),
      }),
    },
    links: {
      projectTeam: {
        forward: { on: "projects", has: "one", label: "team" },
        reverse: { on: "teams", has: "many", label: "projects" },
      },
    },
    rooms: {},
  });

// This would cause infinite recursion:
// const teamDomainWithProjects = domain("teams")
//   .includes(projectDomain)  // ❌ teams needs projects, but projects need teams
//   .schema({
//     entities: {
//       teams: i.entity({
//         name: i.string(),
//         projectId: i.string(),
//       }),
//     },
//     links: {
//       teamProject: {
//         forward: { on: "teams", has: "one", label: "project" },
//         reverse: { on: "projects", has: "one", label: "team" },
//       },
//     },
//     rooms: {},
//   });

// RESULT: Runtime infinite loop or stack overflow

// =====================================================================================
// ⚠️  SCENARIO 3: Multiple Includes (Safe but potentially confusing)
// =====================================================================================

const baseDomain = domain({
  name: "base",
  entities: {
    organizations: i.entity({
      name: i.string(),
      plan: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const feature1Domain = domain("feature1")
  .includes(baseDomain)
  .schema({
    entities: {
      invoices: i.entity({ amount: i.number() }),
    },
    links: {},
    rooms: {},
  });

const feature2Domain = domain("feature2")
  .includes(baseDomain)  // Same domain included twice
  .includes(feature1Domain) // Which also includes baseDomain
  .schema({
    entities: {
      reports: i.entity({ type: i.string() }),
    },
    links: {},
    rooms: {},
  });

// RESULT: Safe but potentially confusing
// - organizations entity appears only once (no duplication)
// - No conflicts because all instances are identical
// - But if baseDomain changed, all dependents would get the new version

// =====================================================================================
// ❌ SCENARIO 4: Base Entity Conflicts (Most Dangerous)
// =====================================================================================

// Problem: Trying to redefine InstantDB base entities

const badDomain = domain({
  name: "bad",
  entities: {
    $users: i.entity({          // ❌ NEVER DO THIS!
      customField: i.string(),  // Base entities are automatically included
    }),
    users: i.entity({           // ✅ This is OK (different name)
      name: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

// RESULT: Silent overwrite of base $users entity
// - All cross-domain references to $users might break
// - Authentication and user management could fail

// =====================================================================================
// ✅ SAFE PATTERNS TO AVOID CONFLICTS
// =====================================================================================

// 1. Use clear naming conventions - each domain owns its entities
// 2. Domain-specific prefixes (finance_accounts, api_logs, etc.)
// 3. Use includes() only for cross-references, not ownership
// 4. Document which domains provide which entities
// 5. Test thoroughly when adding new includes()

// =====================================================================================
// 🔧 POTENTIAL ENHANCEMENT: Conflict Detection
// =====================================================================================

/*
// Runtime conflict detection could be added to domain builder:
function detectEntityConflicts(domainResult: DomainSchemaResult): string[] {
  const conflicts: string[] = [];
  const seen = new Set<string>();

  for (const entityName of Object.keys(domainResult.entities)) {
    if (seen.has(entityName)) {
      conflicts.push(entityName);
    }
    seen.add(entityName);
  }

  return conflicts;
}

// Usage:
const conflicts = detectEntityConflicts(myDomain);
if (conflicts.length > 0) {
  console.warn("Entity conflicts detected:", conflicts);
}
*/

export {}; // Make this a module
