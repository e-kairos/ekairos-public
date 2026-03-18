import { expect, test } from "@playwright/test";
import setupCodexRealEnvironment from "../../../reactors/openai-reactor/src/tests/setup/codex-real.setup.ts";

const runRealCodexE2E = process.env.CODEX_REAL_E2E === "1";
const codexTest = runRealCodexE2E ? test : test.skip;

let cleanupCodexEnvironment: (() => Promise<void>) | void;

test.beforeAll(async () => {
  const explicitRealUrl = String(process.env.CODEX_REACTOR_REAL_URL ?? "").trim();
  if (explicitRealUrl) {
    process.env.CODEX_REACTOR_REAL = "0";
    process.env.CODEX_REACTOR_REAL_URL = explicitRealUrl;
  } else {
    process.env.CODEX_REACTOR_REAL = "1";
    process.env.CODEX_REACTOR_REAL_PORT = "4310";
    delete process.env.CODEX_REACTOR_REAL_URL;
  }
  cleanupCodexEnvironment = await setupCodexRealEnvironment();
});

test.afterAll(async () => {
  if (cleanupCodexEnvironment) {
    await cleanupCodexEnvironment();
  }
});

codexTest("examples/codex runs through context + codex reactor with real codex app-server", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto("/examples/codex");
  await page
    .getByTestId("examples-codex-input")
    .fill("Inspect README.md and summarize the key points.");

  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/examples/reactors/codex/run") &&
      response.request().method() === "POST",
    { timeout: 240_000 },
  );

  await page.getByTestId("examples-codex-run").click();

  await expect
    .poll(
      async () => await page.getByTestId("message-assistant").count(),
      { timeout: 240_000 },
    )
    .toBeGreaterThanOrEqual(1);

  const runResponse = await runResponsePromise;

  expect(runResponse.status()).toBe(200);
  const payload = (await runResponse.json()) as {
    ok?: boolean;
    data?: {
      trace?: {
        events?: unknown[];
        chunks?: unknown[];
      };
      metadata?: {
        providerContextId?: string | null;
        turnId?: string | null;
      };
      assistantEvent?: { id?: string };
    };
  };

  expect(payload.ok).toBe(true);
  expect(Array.isArray(payload.data?.trace?.events)).toBe(true);
  expect((payload.data?.trace?.events ?? []).length).toBeGreaterThan(0);
  expect(Array.isArray(payload.data?.trace?.chunks)).toBe(true);
  expect(payload.data?.assistantEvent?.id).toBeTruthy();
  expect(payload.data?.metadata?.providerContextId).toBeTruthy();
  expect(payload.data?.metadata?.turnId).toBeTruthy();

  await expect(page.getByTestId("examples-codex-message-list")).toBeVisible();

  await expect
    .poll(
      async () => {
        const content = await page.getByTestId("examples-codex-message-list").textContent();
        return (content ?? "").trim().length;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
});
