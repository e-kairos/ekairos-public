import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["../openai-reactor-real-tests/**/*.test.ts"],
    reporters: "verbose",
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
})
