import { afterAll, beforeAll, describe } from "vitest";

import { runtimeWorkflowDomain } from "../runtime.workflow-fixtures.js";

function hasInstantProvisionToken() {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim());
}

export const describeRuntimeWorkflow = hasInstantProvisionToken() ? describe : describe.skip;

export function useRuntimeWorkflowTestApp() {
  let appId = "";
  let adminToken = "";

  beforeAll(async () => {
    // given: workflow integration tests need a temporary Instant app whose
    // schema matches the runtime workflow domain fixture.
    const { createTestApp } = await import("@ekairos/testing/provision");
    const app = await createTestApp({
      name: `domain-runtime-workflow-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      schema: runtimeWorkflowDomain.toInstantSchema(),
    });

    appId = app.appId;
    adminToken = app.adminToken;
  }, 5 * 60 * 1000);

  afterAll(async () => {
    // then: the temp app is removed unless the caller explicitly asks to keep
    // test apps for debugging.
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      const { destroyTestApp } = await import("@ekairos/testing/provision");
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      });
    }
  }, 5 * 60 * 1000);

  return {
    credentials() {
      return { appId, adminToken };
    },
  };
}
