import { expect, test, type APIRequestContext } from "@playwright/test";

export async function runStructureE2E(
  request: APIRequestContext,
  params: {
    endpoint: string;
    orgId?: string;
  },
) {
  let runId = "unknown";
  try {
    const res = await request.post(params.endpoint, {
      data: { orgId: params.orgId ?? "test-org" },
    });
    const body = await res.json();

    runId = String(body?.runId ?? "unknown");
    console.log(`WORKFLOW_RUN_ID_START=${runId}`);

    if (res.status() !== 200) {
      console.log("structure-e2e non-200 response body");
      console.log(JSON.stringify(body, null, 2));
    }

    expect(res.status()).toBe(200);
    return body as any;
  } finally {
    // Ensure no test ends without the run id marker.
    console.log(`WORKFLOW_RUN_ID_END=${runId}`);
  }
}

export function configureE2ETimeouts() {
  test.setTimeout(600_000);
}

