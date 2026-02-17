import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() combined datasets (products + categories) -> object summary (schema)", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.mixed.datasetsJoin.object.schema";
  const body = await runStructureE2E(request, { endpoint });
  expect(body.value).toEqual({
    totalProducts: 3,
    categories: [
      { categoryName: "Hardware", count: 2, avgPrice: 615.375 },
      { categoryName: "Software", count: 1, avgPrice: 20 },
    ],
  });
});

