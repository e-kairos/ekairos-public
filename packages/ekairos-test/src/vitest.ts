import type { Reporter } from "vitest";

import { EkairosRunOptions, initRunContext } from "./core.js";

function statusFromVitest(state?: string): "passed" | "failed" | "skipped" {
  if (state === "pass") return "passed";
  if (state === "skip" || state === "todo") return "skipped";
  return "failed";
}

function caseIdFrom(test: any): string {
  const file = test?.file?.filepath || "unknown";
  const name = test?.name || "unnamed";
  return `vitest::${file}::${name}`;
}

export function ekairosVitestReporter(options: EkairosRunOptions = {}): Reporter {
  const ctx = initRunContext("vitest", options);

  return {
    onInit(vitest: any) {
      const tests = vitest?.state?.getFiles?.() || [];
      let total = 0;
      for (const file of tests) {
        total += file.tasks?.length || 0;
      }
      ctx.summary.total = total;
    },
    onTestEnd(test: any) {
      const state = test?.result?.state || "fail";
      const status = statusFromVitest(state);
      if (status === "passed") ctx.summary.passed += 1;
      if (status === "failed") ctx.summary.failed += 1;
      if (status === "skipped") ctx.summary.skipped += 1;

      ctx.writeResult({
        schemaVersion: "1.0",
        runId: ctx.runId,
        caseId: caseIdFrom(test),
        title: test?.name,
        file: test?.file?.filepath,
        status,
        durationMs: test?.result?.duration,
        retry: test?.result?.retryCount || 0,
        startAt: test?.result?.startTime ? new Date(test.result.startTime).toISOString() : undefined,
        endAt: new Date().toISOString(),
      });
    },
    onFinished() {
      const status = ctx.summary.failed > 0 ? "failed" : "passed";
      ctx.finalize(status);
    },
  } as Reporter;
}
