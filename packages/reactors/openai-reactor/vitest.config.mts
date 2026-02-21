import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    reporters: "verbose",
    globalSetup: ["src/tests/setup/codex-real.setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
})
