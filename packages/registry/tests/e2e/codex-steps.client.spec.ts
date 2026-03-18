import { expect, test } from "@playwright/test";

test("showcases/codex-steps bootstraps a client-side Instant scenario and restart creates a new context", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/showcases/codex-steps");

  await expect(page.getByTestId("codex-steps-panel-status")).toBeVisible();

  await expect
    .poll(
      async () =>
        ((await page.getByTestId("codex-steps-panel-context-id").textContent()) ?? "").trim(),
      { timeout: 60_000 },
    )
    .toMatch(/contextId:\s(?!-).+/);

  await expect
    .poll(
      async () => await page.getByTestId("codex-steps-panel-step-row").count(),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () =>
        ((await page.getByTestId("codex-steps-panel-status").textContent()) ?? "").trim(),
      { timeout: 60_000 },
    )
    .toContain("completed");

  await expect
    .poll(
      async () =>
        ((await page.getByTestId("codex-steps-panel-stored-parts").textContent()) ?? "").trim()
          .length,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(20);

  const previousContextId =
    ((await page.getByTestId("codex-steps-panel-context-id").textContent()) ?? "").trim();

  await page.getByTestId("codex-steps-panel-restart").click();

  await expect
    .poll(
      async () =>
        ((await page.getByTestId("codex-steps-panel-context-id").textContent()) ?? "").trim(),
      { timeout: 60_000 },
    )
    .not.toBe(previousContextId);
});
