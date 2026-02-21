import { expect, test } from "@playwright/test";

const EXPECTED_STREAM_LABELS = [
  "thread/started",
  "Thread started",
  "Turn completed",
  "assistant text completed",
];

test.describe("registry demo UI", () => {
  test("provisions tenant, bootstraps runtime, and renders codex streaming timeline", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    await page.goto("/demo");

    const tenantSummary = page.getByTestId("registry-demo-tenant-summary");
    await expect(tenantSummary).not.toHaveText("No tenant");

    const tenantStatus = page.getByTestId("registry-demo-tenant-status-text");
    await expect(tenantStatus).toContainText("Tenant ready");

    await page.getByTestId("registry-demo-action-bootstrap-runtime").click();
    await expect(page.getByTestId("registry-demo-bootstrap-stats")).toBeVisible();

    const prompt = page.getByTestId("registry-demo-input");
    await prompt.fill("Inspect README.md and reply with a short summary of what it contains.");

    const runButton = page.getByTestId("registry-demo-action-run-replay");
    await runButton.click();

    await expect.poll(async () => {
      return await page.getByTestId("registry-demo-stream-row").count();
    }).toBeGreaterThanOrEqual(7);

    await expect(runButton).toBeEnabled();

    const labels = await page.getByTestId("registry-demo-stream-label").allTextContents();
    for (const expectedLabel of EXPECTED_STREAM_LABELS) {
      expect(labels).toContain(expectedLabel);
    }

    const parts = await page.getByTestId("registry-demo-stream-part").allTextContents();
    expect(parts.some((part) => part.includes("codex-event"))).toBe(true);

    const messageList = page.getByTestId("registry-demo-message-list");
    await expect(messageList).toContainText(
      "README.md contains a short description for the Ekairos coding agent trace test.",
    );

    await expect.poll(async () => {
      return await page.getByTestId("registry-demo-sync-row").count();
    }).toBeGreaterThan(0);

    await expect(page.getByTestId("registry-demo-entity-count-items")).toContainText("items:");
    await expect(page.getByTestId("registry-demo-entity-count-steps")).toContainText("steps:");

    await expect.poll(async () => {
      return await page.getByTestId("registry-demo-entities-item-row").count();
    }).toBeGreaterThan(0);

    await expect.poll(async () => {
      return await page.getByTestId("registry-demo-entities-step-row").count();
    }).toBeGreaterThan(0);
  });
});
