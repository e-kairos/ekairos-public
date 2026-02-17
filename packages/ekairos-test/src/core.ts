import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type EkairosPrMeta = {
  provider?: string;
  id?: string;
  url?: string;
};

export type EkairosRepoMeta = {
  name?: string;
  path?: string;
  commit?: string;
  branch?: string;
};

export type EkairosRunOptions = {
  outputDir?: string;
  runId?: string;
  taskId?: string;
  pr?: EkairosPrMeta;
  repo?: EkairosRepoMeta;
  captureWorkflows?: boolean;
  workflowDataDir?: string;
  workflowApiBaseUrl?: string;
  workflowApiKey?: string;
  workflowProjectId?: string;
  command?: string;
  project?: string;
};

export type EkairosRunSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

export type EkairosRunContext = {
  runId: string;
  runDir: string;
  outputDir: string;
  startedAt: string;
  summary: EkairosRunSummary;
  writeResult: (record: Record<string, unknown>) => void;
  writeLog: (record: Record<string, unknown>) => void;
  addArtifact: (record: Record<string, unknown>) => void;
  finalize: (status: "passed" | "failed") => void;
};

const DEFAULT_OUTPUT_DIR = ".ekairos/test-runs";
const LATEST_RUN_FILE = "latest";

function nowIso() {
  return new Date().toISOString();
}

function safeExec(cmd: string, cwd?: string): string | undefined {
  try {
    const out = execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function resolveRepoMeta(cwd: string, input?: EkairosRepoMeta): EkairosRepoMeta {
  const gitRoot = safeExec("git rev-parse --show-toplevel", cwd);
  const repoPath = input?.path || gitRoot || cwd;
  const name = input?.name || (repoPath ? path.basename(repoPath) : undefined);
  const commit = input?.commit || safeExec("git rev-parse HEAD", repoPath);
  const branch = input?.branch || safeExec("git rev-parse --abbrev-ref HEAD", repoPath);
  return { name, path: repoPath, commit, branch };
}

function resolvePrMeta(input?: EkairosPrMeta): EkairosPrMeta {
  const env = process.env;
  return {
    provider: input?.provider || env.EKAIROS_PR_PROVIDER || env.PR_PROVIDER,
    id: input?.id || env.EKAIROS_PR_ID || env.PR_ID,
    url: input?.url || env.EKAIROS_PR_URL || env.PR_URL,
  };
}

function resolveTaskId(input?: string): string | undefined {
  return input || process.env.EKAIROS_TASK_ID;
}

function readLatestRunId(outputDir: string): string | undefined {
  try {
    const latestPath = path.resolve(process.cwd(), outputDir, LATEST_RUN_FILE);
    const raw = fs.readFileSync(latestPath, "utf-8").trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

function writeLatestRunId(outputDir: string, runId: string) {
  try {
    const latestPath = path.resolve(process.cwd(), outputDir, LATEST_RUN_FILE);
    fs.writeFileSync(latestPath, `${runId}\n`);
  } catch {
    // Best-effort only; ignore failures.
  }
}

function resolveRunId(input?: string, outputDir?: string, preferLatest = false): string {
  if (input) return input;
  const envRunId = process.env.EKAIROS_TEST_RUN_ID || process.env.EKAIROS_RUN_ID;
  if (envRunId) return envRunId;
  if (preferLatest) {
    const latest = readLatestRunId(outputDir || resolveOutputDir(undefined));
    if (latest) return latest;
  }
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const rand = crypto.randomBytes(3).toString("hex");
  return `run_${stamp}_${rand}`;
}

function resolveOutputDir(input?: string): string {
  return input || process.env.EKAIROS_TEST_OUTPUT || DEFAULT_OUTPUT_DIR;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendJsonl(filePath: string, data: unknown) {
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function initRunContext(
  runner: "playwright" | "vitest",
  options: EkairosRunOptions = {}
): EkairosRunContext {
  const outputDir = resolveOutputDir(options.outputDir);
  const runId = resolveRunId(options.runId, outputDir, false);
  const runDir = path.resolve(process.cwd(), outputDir, runId);
  const startedAt = nowIso();

  ensureDir(runDir);
  ensureDir(path.join(runDir, "artifacts"));
  ensureDir(path.join(runDir, "context"));
  ensureDir(path.join(runDir, "workflows"));
  ensureDir(path.join(runDir, "workflows", "events"));

  const repo = resolveRepoMeta(process.cwd(), options.repo);
  const pr = resolvePrMeta(options.pr);
  const prData = pr.provider || pr.id || pr.url ? pr : undefined;
  const taskId = resolveTaskId(options.taskId);

  const summary: EkairosRunSummary = { total: 0, passed: 0, failed: 0, skipped: 0 };

  const runRecord: Record<string, unknown> = {
    schemaVersion: "1.0",
    runId,
    runner,
    repo,
    pr: prData,
    task: taskId ? { id: taskId } : undefined,
    startedAt,
    finishedAt: null,
    status: "running",
    summary,
    environment: {
      node: process.version,
      os: process.platform,
      ci: Boolean(process.env.CI),
    },
    config: {
      command: options.command,
      project: options.project,
    },
  };

  writeJson(path.join(runDir, "run.json"), runRecord);

  process.env.EKAIROS_TEST_RUN_ID = runId;
  process.env.EKAIROS_TEST_RUN_DIR = runDir;
  process.env.EKAIROS_TEST_OUTPUT = outputDir;
  writeLatestRunId(outputDir, runId);

  const artifactsIndexPath = path.join(runDir, "artifacts", "index.json");
  const artifactsIndex = readJson<{ schemaVersion: string; artifacts: Record<string, unknown>[] }>(
    artifactsIndexPath,
    { schemaVersion: "1.0", artifacts: [] }
  );

  const context: EkairosRunContext = {
    runId,
    runDir,
    outputDir,
    startedAt,
    summary,
    writeResult(record) {
      appendJsonl(path.join(runDir, "results.jsonl"), record);
    },
    writeLog(record) {
      appendJsonl(path.join(runDir, "logs.jsonl"), record);
    },
    addArtifact(record) {
      artifactsIndex.artifacts.push(record);
      writeJson(artifactsIndexPath, artifactsIndex);
    },
    finalize(status) {
      const finishedAt = nowIso();
      if (summary.total === 0) {
        summary.total = summary.passed + summary.failed + summary.skipped;
      }
      const finalRecord = {
        ...runRecord,
        finishedAt,
        status,
        summary,
      };
      writeJson(path.join(runDir, "run.json"), finalRecord);
    },
  };

  return context;
}

export function resolveRunDir(
  outputDir?: string,
  runId?: string
): { runDir: string; runId: string; outputDir: string } {
  const finalOutput = resolveOutputDir(outputDir);
  const finalRunId = resolveRunId(runId, finalOutput, true);
  const runDir = path.resolve(process.cwd(), finalOutput, finalRunId);
  return { runDir, runId: finalRunId, outputDir: finalOutput };
}

export function loadRunIndex(filePath: string): Record<string, unknown> {
  return readJson<Record<string, unknown>>(filePath, {});
}

export function writeRunIndex(filePath: string, data: Record<string, unknown>) {
  writeJson(filePath, data);
}

export function copyArtifact(
  sourcePath: string,
  destDir: string,
  fileName?: string
): { destPath: string; size: number } {
  ensureDir(destDir);
  const baseName = fileName || path.basename(sourcePath);
  const destPath = path.join(destDir, baseName);
  fs.copyFileSync(sourcePath, destPath);
  const stat = fs.statSync(destPath);
  return { destPath, size: stat.size };
}

export function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}
