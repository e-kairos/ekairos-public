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

describe("create-app secret redaction", () => {
  it("does not print admin tokens in non-interactive output by default", async () => {
    // given: a non-interactive JSON create-app command with an admin token.
    const targetDir = await createTrackedTargetDir(tempDirs);
    const io = createIo();

    // when: the CLI scaffolds the app and writes the token to the env file.
    const code = await runCli(
      [
        "create-app",
        targetDir,
        "--next",
        "--no-install",
        "--package-manager=pnpm",
        "--appId=app_public",
        "--adminToken=secret_admin_token",
        "--json",
      ],
      io.io as any,
    );

    const payload = JSON.parse(io.read().stdout);

    // then: the structured response reports that the token was written but does
    // not include the secret in stdout.
    expect(code, io.read().stderr).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.data.appId).toBe("app_public");
    expect(payload.data.adminToken).toBeUndefined();
    expect(payload.data.adminTokenWritten).toBe(true);
    expect(payload.data.envFile).toContain(".env.local");
    expect(io.read().stdout).not.toContain("secret_admin_token");
  });
});
