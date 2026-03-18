import { expect, test, type Page } from "@playwright/test";

async function expectEventStepsDemoToComplete(page: Page) {
  await expect(page.getByTestId("event-steps-status")).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await page.getByTestId("event-steps-status").textContent()) ?? "").trim(),
      { timeout: 60_000 },
    )
    .toContain("completed");
}

test("events domain exposes overview, demos, and event-steps preview", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/docs/domains/events");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.locator("a[href='/docs/domains/events/demos/scripted']").first()).toBeVisible();
  await expect(page.locator("a[href='/docs/domains/events/demos/ai-sdk']").first()).toBeVisible();
  await expect(page.locator("a[href='/docs/domains/events/demos/codex']").first()).toBeVisible();

  await page.goto("/docs/domains/events/demos/scripted");
  await expectEventStepsDemoToComplete(page);

  await page.goto("/docs/domains/events/demos/ai-sdk");
  await expectEventStepsDemoToComplete(page);

  await page.goto("/docs/domains/events/demos/codex");
  await expectEventStepsDemoToComplete(page);

  await page.goto("/docs/components/event-steps");
  await expect(page.getByRole("heading", { name: "Event Steps" })).toBeVisible();
  await expect(page.getByTestId("component-preview-ephemeral-app")).toBeVisible();
  await expect(page.getByTestId("component-preview-app-id")).toBeVisible();
  await expect(page.getByTestId("event-steps-scenario-scripted")).toBeVisible();

  await expectEventStepsDemoToComplete(page);

  await page.getByTestId("event-steps-scenario-ai-sdk").click();
  await expect(page.getByRole("heading", { name: "AI SDK", level: 3 })).toBeVisible();
  await expectEventStepsDemoToComplete(page);

  await page.getByTestId("event-steps-scenario-codex").click();
  await expect(page.getByRole("heading", { name: "Codex", level: 3 })).toBeVisible();
  await expectEventStepsDemoToComplete(page);
});
