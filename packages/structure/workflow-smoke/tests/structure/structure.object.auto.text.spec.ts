import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() (object + auto) text input", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.object.auto.text";
  const body = await runStructureE2E(request, { endpoint });
  expect(body.value).toEqual({ recordCount: 3, currency: "USD" });
});

