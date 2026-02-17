import { test, expect } from "@playwright/test";
import { configureE2ETimeouts } from "./_client";

configureE2ETimeouts();

test("structure-e2e rows_schema_sample_pdf (sample.pdf fixture)", async ({ request }) => {
  let runId = "unknown";
  try {
    const res = await request.post("/api/internal/workflow/structure-e2e", {
      data: { orgId: "test-org", scenario: "rows_schema_sample_pdf" },
    });

    const body = await res.json();
    runId = String(body?.runId ?? "unknown");
    console.log(`WORKFLOW_RUN_ID_START=${runId}`);

    if (res.status() !== 200) {
      console.log("structure-e2e non-200 response body");
      console.log(JSON.stringify(body, null, 2));
    }

    expect(res.status()).toBe(200);
    expect(body.rowsOutput?.ok).toBe(true);
    expect(body.rowsOutput?.dataRows).toEqual([
      { code: "A1", description: "Widget", price: 10.5 },
      { code: "A2", description: "Gadget", price: 20 },
      { code: "A3", description: "Thing", price: 30.25 },
    ]);
  } finally {
    console.log(`WORKFLOW_RUN_ID_END=${runId}`);
  }
});
