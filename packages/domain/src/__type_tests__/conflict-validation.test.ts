// Runtime validation demo for conflict detection
// This demonstrates that runtime validation prevents entity name conflicts

import { domain } from "../index";

// Simple test runner
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
  }
}

function expect(fn: () => any) {
  return {
    toThrow(expectedMessage?: string) {
      try {
        fn();
        throw new Error("Expected function to throw, but it didn't");
      } catch (error) {
        if (expectedMessage && !error.message.includes(expectedMessage)) {
          throw new Error(`Expected error message to contain "${expectedMessage}", but got: "${error.message}"`);
        }
      }
    }
  };
}

function expectNot(fn: () => any) {
  return {
    toThrow() {
      try {
        fn();
        // Success - didn't throw
      } catch (error) {
        throw new Error(`Expected function not to throw, but it threw: ${error.message}`);
      }
    }
  };
}

// Test domains with conflicting entity names
const domainA = domain({
  name: "domainA",
  entities: {
    users: { name: "mock" }, // Mock entity for testing
  },
  links: {},
  rooms: {},
});

const domainB = domain({
  name: "domainB",
  entities: {
    users: { age: 25 }, // Same entity name - conflict!
  },
  links: {},
  rooms: {},
});

// Run tests
console.log("🧪 Testing Domain Conflict Validation\n");

// Test 1: Conflict in includes() should throw error
test("includes() detects entity name conflicts", () => {
  expect(() => {
    domain("test")
      .includes(domainA)
      .includes(domainB); // This should throw
  }).toThrow("domain.includes()");
});

// Test 2: Conflict in schema() should throw error
test("schema() detects entity name conflicts", () => {
  expect(() => {
    domain("test")
      .includes(domainA)
      .schema({
        entities: {
          users: { email: "test@example.com" }, // Same name - conflict!
        },
        links: {},
        rooms: {},
      }); // This should throw
  }).toThrow("domain.schema()");
});

// Test 3: No conflicts should work fine
test("no conflicts works correctly", () => {
  const safeDomainA = domain({
    name: "safeA",
    entities: { profiles: { name: "John" } },
    links: {},
    rooms: {},
  });

  const safeDomainB = domain({
    name: "safeB",
    entities: { accounts: { balance: 100 } },
    links: {},
    rooms: {},
  });

  expectNot(() => {
    const result = domain("safe")
      .includes(safeDomainA)
      .includes(safeDomainB)
      .schema({
        entities: { transactions: { amount: 50 } },
        links: {},
        rooms: {},
      });

    // Should work without throwing
    if (!result) throw new Error("Result should be defined");
    if (!result.entities.profiles) throw new Error("Should have profiles");
    if (!result.entities.accounts) throw new Error("Should have accounts");
    if (!result.entities.transactions) throw new Error("Should have transactions");
  }).toThrow();
});

// Test 4: toInstantSchema() works on valid domains
test("toInstantSchema() works on valid domains", () => {
  const validDomain = domain("valid")
    .includes(
      domain({ name: "posts", entities: { posts: { title: "Test" } }, links: {}, rooms: {} })
    )
    .schema({
      entities: { comments: { text: "Comment" } },
      links: {},
      rooms: {},
    });

  expectNot(() => {
    const schema = validDomain.toInstantSchema();
    if (!schema) throw new Error("Schema should be defined");
  }).toThrow();
});

console.log("\n✨ Conflict validation is working correctly!");
