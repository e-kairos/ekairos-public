import { defineConfig } from "vitest/config";

async function resolveReporters() {
  const reporters: unknown[] = ["default"];

  try {
    const mod = await import("@ekairos/testing/vitest");
    if (typeof mod.ekairosVitestReporter === "function") {
      reporters.push(mod.ekairosVitestReporter({ project: "domain-e2e" }));
    }
  } catch {
    // optional reporter
  }

  return reporters;
}

export default defineConfig(async () => ({
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: await resolveReporters(),
  },
}));
