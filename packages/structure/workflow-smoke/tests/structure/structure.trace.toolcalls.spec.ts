import { test, expect } from "@playwright/test";
import { configureE2ETimeouts, runStructureE2E } from "./_client";

configureE2ETimeouts();

test("structure() trace (events + toolcalls)", async ({ request }) => {
  const endpoint = "/api/internal/workflow/structure/structure.trace.toolcalls";
  const body = await runStructureE2E(request, { endpoint });

  expect(body.trace?.eventsCount).toBeGreaterThan(0);
  expect(body.trace?.toolPartsCount).toBeGreaterThan(0);
  expect(body.trace?.hasSettledToolPart).toBe(true);
});

