import { expect, test } from "@playwright/test";
import setupCodexRealEnvironment from "../../../reactors/openai-reactor/src/tests/setup/codex-real.setup.ts";

const runRealCodexE2E = process.env.CODEX_REAL_E2E === "1";
const codexTest = runRealCodexE2E ? test : test.skip;

let cleanupCodexEnvironment: (() => Promise<void>) | void;

codexTest.beforeAll(async () => {
  process.env.CODEX_REACTOR_REAL = "1";
  process.env.CODEX_REACTOR_REAL_PORT = "4310";
  delete process.env.CODEX_REACTOR_REAL_URL;
  cleanupCodexEnvironment = await setupCodexRealEnvironment();
});

codexTest.afterAll(async () => {
  if (cleanupCodexEnvironment) {
    await cleanupCodexEnvironment();
  }
});

codexTest("codex-demo route runs through thread + codex reactor with real codex app-server", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto("/codex-demo");
  await page.getByTestId("codex-demo-input").fill("Reply with the single word OK.");

  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/codex-demo/run") &&
      response.request().method() === "POST",
    { timeout: 240_000 },
  );

  await page.getByTestId("codex-demo-run").click();
  const runResponse = await runResponsePromise;

  expect(runResponse.status()).toBe(200);
  const payload = (await runResponse.json()) as {
    ok?: boolean;
    data?: {
      events?: unknown[];
      chunks?: unknown[];
      assistantEvent?: { id?: string };
    };
  };

  expect(payload.ok).toBe(true);
  expect(Array.isArray(payload.data?.events)).toBe(true);
  expect((payload.data?.events ?? []).length).toBeGreaterThan(0);
  expect(Array.isArray(payload.data?.chunks)).toBe(true);
  expect(payload.data?.assistantEvent?.id).toBeTruthy();
  await expect(page.getByTestId("codex-demo-last-error")).toHaveText("-");
});

