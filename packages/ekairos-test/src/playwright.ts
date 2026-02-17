import fs from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult, Suite } from "@playwright/test/reporter";

import {
  EkairosRunOptions,
  initRunContext,
  copyArtifact,
  safeFileName,
} from "./core.js";
import { captureLocalWorkflowTrace, recordWorkflowRun, resolveWorkflowDataDir } from "./story.js";

function statusFromResult(result: TestResult): "passed" | "failed" | "skipped" {
  if (result.status === "passed") return "passed";
  if (result.status === "skipped") return "skipped";
  return "failed";
}

function caseIdFor(test: TestCase): string {
  const file = test.location?.file || "unknown";
  const titlePath = test.titlePath().join(" :: ");
  return `pw::${file}::${titlePath}`;
}

export class EkairosPlaywrightReporter implements Reporter {
  private options: EkairosRunOptions;
  private ctx = initRunContext("playwright");
  private artifactSeq = 0;
  private workflowRunIds = new Set<string>();

  constructor(options: EkairosRunOptions = {}) {
    this.options = options;
  }

  onBegin(_suite: Suite) {
    this.ctx = initRunContext("playwright", this.options);
    if (typeof (_suite as any)?.allTests === "function") {
      this.ctx.summary.total = (_suite as any).allTests().length;
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const status = statusFromResult(result);
    if (status === "passed") this.ctx.summary.passed += 1;
    if (status === "failed") this.ctx.summary.failed += 1;
    if (status === "skipped") this.ctx.summary.skipped += 1;

    const attachments: string[] = [];
    for (const attachment of result.attachments || []) {
      if (!attachment.path) continue;
      const artifactId = `artifact_${String(++this.artifactSeq).padStart(4, "0")}`;
      const baseName = safeFileName(path.basename(attachment.path));
      const fileName = `${artifactId}_${baseName}`;
      const destDir = path.join(this.ctx.runDir, "artifacts");
      const { destPath, size } = copyArtifact(attachment.path, destDir, fileName);
      const record = {
        artifactId,
        type: attachment.name || "attachment",
        path: path.relative(this.ctx.runDir, destPath),
        mime: attachment.contentType || "application/octet-stream",
        size,
        testCaseId: caseIdFor(test),
        createdAt: new Date().toISOString(),
      };
      this.ctx.addArtifact(record);
      attachments.push(artifactId);
    }

    this.ctx.writeResult({
      schemaVersion: "1.0",
      runId: this.ctx.runId,
      caseId: caseIdFor(test),
      title: test.title,
      file: test.location?.file,
      line: test.location?.line,
      status,
      durationMs: result.duration,
      retry: result.retry,
      startAt: result.startTime ? new Date(result.startTime).toISOString() : undefined,
      endAt: new Date().toISOString(),
      attachments,
    });
  }

  onStdOut(chunk: string | Buffer, test?: TestCase) {
    this.tryCaptureWorkflowIds(chunk.toString(), test);
    this.ctx.writeLog({
      schemaVersion: "1.0",
      runId: this.ctx.runId,
      level: "info",
      source: "runner",
      timestamp: new Date().toISOString(),
      message: chunk.toString(),
      testCaseId: test ? caseIdFor(test) : undefined,
    });
  }

  onStdErr(chunk: string | Buffer, test?: TestCase) {
    this.tryCaptureWorkflowIds(chunk.toString(), test);
    this.ctx.writeLog({
      schemaVersion: "1.0",
      runId: this.ctx.runId,
      level: "error",
      source: "runner",
      timestamp: new Date().toISOString(),
      message: chunk.toString(),
      testCaseId: test ? caseIdFor(test) : undefined,
    });
  }

  async onEnd() {
    await this.captureWorkflowTraces();
    const status = this.ctx.summary.failed > 0 ? "failed" : "passed";
    this.ctx.finalize(status);
  }

  private tryCaptureWorkflowIds(message: string, test?: TestCase) {
    if (!this.isWorkflowCaptureEnabled()) return;
    const caseId = test ? caseIdFor(test) : undefined;
    const patterns = [
      /workflowRunId[:=]\\s*([A-Za-z0-9_-]+)/gi,
      /\\bwrun_[A-Za-z0-9_-]+\\b/gi,
    ];
    const found: string[] = [];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(message))) {
        const id = match[1] || match[0];
        if (id && !this.workflowRunIds.has(id)) {
          this.workflowRunIds.add(id);
          found.push(id);
          recordWorkflowRun({ workflowRunId: id, source: "log", caseId });
        }
      }
    }
    if (found.length > 0) {
      this.ctx.writeLog({
        schemaVersion: "1.0",
        runId: this.ctx.runId,
        level: "info",
        source: "runner",
        timestamp: new Date().toISOString(),
        message: `captured workflowRunId(s): ${found.join(", ")}`,
        testCaseId: caseId,
      });
    }
  }

  private isWorkflowCaptureEnabled() {
    if (this.options.captureWorkflows === false) return false;
    const env = String(process.env.EKAIROS_DISABLE_WORKFLOW_CAPTURE || "").toLowerCase();
    if (env === "1" || env === "true") return false;
    return true;
  }

  private async captureWorkflowTraces() {
    if (!this.isWorkflowCaptureEnabled()) return;
    const dataDir = resolveWorkflowDataDir(this.options.workflowDataDir);
    if (!fs.existsSync(dataDir)) {
      this.ctx.writeLog({
        schemaVersion: "1.0",
        runId: this.ctx.runId,
        level: "warn",
        source: "runner",
        timestamp: new Date().toISOString(),
        message: `workflow trace capture skipped: local data dir not found (${dataDir})`,
      });
      return;
    }

    const indexPath = path.join(this.ctx.runDir, "workflows", "index.json");
    const indexRuns = this.loadWorkflowIndex(indexPath);
    const runIds = new Set<string>([...this.workflowRunIds]);
    for (const entry of indexRuns) {
      if (entry.workflowRunId) runIds.add(entry.workflowRunId);
    }
    for (const discovered of this.discoverLocalRunIds(dataDir)) {
      runIds.add(discovered);
    }

    if (runIds.size === 0) {
      this.ctx.writeLog({
        schemaVersion: "1.0",
        runId: this.ctx.runId,
        level: "warn",
        source: "runner",
        timestamp: new Date().toISOString(),
        message: "workflow trace capture skipped: no workflow run ids found",
      });
      return;
    }

    for (const workflowRunId of runIds) {
      try {
        captureLocalWorkflowTrace({
          workflowRunId,
          dataDir,
          outputDir: this.ctx.outputDir,
          runId: this.ctx.runId,
          source: "auto",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.ctx.writeLog({
          schemaVersion: "1.0",
          runId: this.ctx.runId,
          level: "warn",
          source: "runner",
          timestamp: new Date().toISOString(),
          message: `workflow trace capture failed for ${workflowRunId}: ${msg}`,
        });
      }
    }
  }

  private loadWorkflowIndex(indexPath: string): Array<{ workflowRunId?: string }> {
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const parsed = JSON.parse(raw) as any;
      if (!parsed || !Array.isArray(parsed.runs)) return [];
      return parsed.runs;
    } catch {
      return [];
    }
  }

  private discoverLocalRunIds(dataDir: string): string[] {
    try {
      const runsDir = path.join(dataDir, "runs");
      if (!fs.existsSync(runsDir)) return [];
      const startAt = Date.parse(this.ctx.startedAt);
      const cutoff = Number.isFinite(startAt) ? startAt - 60_000 : undefined;
      const files = fs.readdirSync(runsDir).filter((file) => file.endsWith(".json"));
      const result: string[] = [];
      for (const file of files) {
        const raw = fs.readFileSync(path.join(runsDir, file), "utf-8");
        const run = JSON.parse(raw) as { runId?: string; createdAt?: string };
        if (!run?.runId) continue;
        if (cutoff) {
          const created = Date.parse(run.createdAt || "");
          if (!Number.isNaN(created) && created < cutoff) continue;
        }
        result.push(run.runId);
      }
      return result;
    } catch {
      return [];
    }
  }
}

export const ekairosPlaywrightReporter = EkairosPlaywrightReporter;
export default EkairosPlaywrightReporter;
