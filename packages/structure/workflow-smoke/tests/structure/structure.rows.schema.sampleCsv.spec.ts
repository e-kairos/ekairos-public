import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() (rows + schema) sample.csv", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.rows.schema.sampleCsv";
  const body = await runStructureE2E(request, { endpoint });

  expect(body.rowsOutput?.ok).toBe(true);
  expect(body.rowsOutput?.dataRows).toEqual([
    { code: "A1", description: "Widget", price: 10.5 },
    { code: "A2", description: "Gadget", price: 20 },
    { code: "A3", description: "Thing", price: 30.25 },
  ]);
});

