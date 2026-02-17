import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3011",
  },
  webServer: {
    // IMPORTANT: do not invoke `pnpm dev` from automation.
    // Use `pnpm exec` so `next` is resolvable on Windows.
    command: "node scripts/start-with-temp-instant.mjs --port 3011",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Playwright webServer only supports 'pipe' | 'ignore' here.
    // 'pipe' keeps server logs visible as [WebServer] ... in test output.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAYWRIGHT_TEST: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

