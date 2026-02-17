import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() mixed sources (dataset -> object) + schema", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.mixed.datasetToObject.schema";
  const body = await runStructureE2E(request, { endpoint });
  expect(body.value).toEqual({ recordCount: 3, minPrice: 10.5, maxPrice: 30.25 });
});

