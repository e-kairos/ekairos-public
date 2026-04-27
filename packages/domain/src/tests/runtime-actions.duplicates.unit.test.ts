/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { defineDomainAction } from "../index.ts";
import { configureRuntime } from "../runtime.ts";
import { createManagementDomain } from "./runtime-actions.test-fixtures.ts";

describe("runtime action duplicate names", () => {
  it("rejects duplicate names between domain actions and explicit runtime actions", () => {
    // given: a domain action already owns the public name
    // management.task.create.
    const { appDomain } = createManagementDomain();

    // when: configureRuntime receives an explicit action with the same public
    // name.
    const configure = () =>
      configureRuntime({
        domain: {
          domain: appDomain,
          actions: [
            defineDomainAction({
              name: "management.task.create",
              execute: () => ({ ok: true }),
            }),
          ],
        },
        runtime: async () => ({ db: { runtimeCall: 1 } }),
      });

    // then: configuration fails immediately so dispatch cannot become
    // ambiguous.
    expect(configure).toThrow("duplicate_runtime_action:management.task.create");
  });
});
