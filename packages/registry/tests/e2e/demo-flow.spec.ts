import { expect, test } from "@playwright/test";

test.describe("registry examples navigation", () => {
  test("landing routes into examples and legacy demo routes are gone", async ({ page }) => {
    await page.goto("/");

    await page.locator("a[href='/examples']").first().click();
    await expect(page).toHaveURL(/\/examples$/);
    await expect(page.getByTestId("reactor-showcase-card")).toHaveCount(1);

    await page.getByTestId("reactor-showcase-card").first().click();
    await expect(page).toHaveURL(/\/examples\/codex$/);
    await expect(page.getByTestId("examples-codex-input")).toBeVisible();

    const demoResponse = await page.goto("/demo");
    expect(demoResponse?.status()).toBe(404);

    const codexDemoResponse = await page.goto("/codex-demo");
    expect(codexDemoResponse?.status()).toBe(404);
  });
});
