/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { runCli } from "../cli/index.js";
import { createIo } from "./create-app.test-fixtures.ts";

describe("create-app help output", () => {
  it("documents create-app flags through command help", async () => {
    // given: an isolated CLI IO adapter.
    const io = createIo();

    // when: the user asks for create-app help.
    const code = await runCli(["create-app", "--help"], io.io as any);

    // then: the command succeeds and documents the non-interactive, smoke, and
    // secret-printing controls.
    expect(code).toBe(0);
    expect(io.read().stdout).toContain("Non-interactive mode");
    expect(io.read().stdout).toContain("--smoke");
    expect(io.read().stdout).toContain("--keep-server");
    expect(io.read().stdout).toContain("--print-secrets");
  });
});
