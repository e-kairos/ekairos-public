/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../cli/index.js";
import {
  cleanupTempDirs,
  createIo,
  createTrackedTargetDir,
} from "./create-app.test-fixtures.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupTempDirs(tempDirs);
});

describe("create-app non-interactive guard", () => {
  it("requires explicit non-interactive create-app mode", async () => {
    // given: a target directory and a command that supplies flags but omits the
    // explicit non-interactive switch.
    const targetDir = await createTrackedTargetDir(tempDirs);
    const io = createIo();

    // when: the CLI receives the create-app command.
    const code = await runCli(
      ["create-app", targetDir, "--next", "--no-install", "--package-manager=pnpm"],
      io.io as any,
    );

    // then: the command rejects the ambiguous mode instead of scaffolding.
    expect(code).toBe(1);
    expect(io.read().stderr).toContain("non-interactive mode is explicit");
  });
});
