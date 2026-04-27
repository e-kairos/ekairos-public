/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createDomainApp,
  type CreateDomainAppProgressEvent,
} from "../cli/create-app.js";
import {
  cleanupTempDirs,
  createTrackedTargetDir,
} from "./create-app.test-fixtures.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupTempDirs(tempDirs);
});

describe("create-app scaffold generation", () => {
  it("emits progress events and writes the scaffold without install", async () => {
    // given: an empty target directory and a non-installing Next scaffold
    // request.
    const targetDir = await createTrackedTargetDir(tempDirs);
    const events: CreateDomainAppProgressEvent[] = [];

    // when: createDomainApp writes the scaffold.
    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      onProgress(event) {
        events.push(event);
      },
    });

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8");
    const domainFile = await readFile(join(targetDir, "src", "domain.ts"), "utf8");
    const workbenchFile = await readFile(join(targetDir, "src", "app", "domain-workbench.tsx"), "utf8");
    const runtimeFile = await readFile(join(targetDir, "src", "runtime.ts"), "utf8");
    const routeFile = await readFile(
      join(targetDir, "src", "app", "api", "ekairos", "domain", "route.ts"),
      "utf8",
    );

    // then: the scaffold result reports no install/provision side effects,
    // progress reaches completion, and every generated file contains the
    // expected domain runtime integration points.
    expect(result.ok).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.adminTokenWritten).toBe(false);
    expect(result.envFile).toBeNull();
    expect(result.smoke).toBeNull();
    expect(events.some((event) => event.stage === "prepare-target" && event.status === "running")).toBe(true);
    expect(events.some((event) => event.stage === "write-files" && event.status === "completed")).toBe(true);
    expect(events.some((event) => event.stage === "complete" && event.status === "completed" && event.progress === 100)).toBe(true);
    expect(packageJson).toContain('"next"');
    expect(packageJson).toContain('"@instantdb/react"');
    expect(packageJson).toContain('"workflow": "^5.0.0-beta.1"');
    expect(packageJson).not.toContain("@workflow/world-local");
    expect(domainFile).toContain('domain("app")');
    expect(domainFile).toContain(".withSchema({");
    expect(domainFile).toContain("baseDomain.withActions({})");
    expect(workbenchFile).toContain("DomainWorkbench");
    expect(workbenchFile).toContain("Add your first domain");
    expect(runtimeFile).toContain("export class AppRuntime");
    expect(runtimeFile).toContain("@ekairos/domain/runtime-handle");
    expect(routeFile).toContain("createRuntimeRouteHandler");
    expect(routeFile).toContain('from "@/runtime"');
    expect(routeFile).not.toContain("@ekairos/thread");
    expect(routeFile).not.toContain(".well-known");
  });
});
