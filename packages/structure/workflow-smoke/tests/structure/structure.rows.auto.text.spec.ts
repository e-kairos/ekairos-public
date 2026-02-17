import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() (rows + auto) text input", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.rows.auto.text";
  const body = await runStructureE2E(request, { endpoint });

  expect(body.rowsOutput?.ok).toBe(true);

  const rows = (body.rowsOutput?.dataRows ?? []) as any[];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  for (const row of rows) {
    expect(typeof row?.code).toBe("string");
    expect(typeof row?.description).toBe("string");
    expect(typeof row?.price).toBe("number");
  }
});

