import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() (rows + schema) complex_products.csv", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.rows.schema.complexCsv";
  const body = await runStructureE2E(request, { endpoint });

  expect(body.rowsOutput?.ok).toBe(true);
  expect(body.rowsOutput?.dataRows).toEqual([
    { code: "P-001", description: "Widget, Deluxe", price: 1200.5, categoryId: "C-1" },
    { code: "P-002", description: 'Gadget "Pro"', price: 20, categoryId: "C-2" },
    { code: "P-003", description: "Thing", price: 30.25, categoryId: "C-1" },
  ]);
});

