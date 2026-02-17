import fs from "node:fs";
import path from "node:path";

import { resolveRunDir, writeRunIndex } from "./core.js";

export type WorkflowTraceEntry = {
  workflowRunId: string;
  source?: string;
  caseId?: string;
  projectId?: string;
  createdAt?: string;
  runPath?: string;
  eventsPath?: string;
  stepsPath?: string;
  hooksPath?: string;
  streamsPath?: string;
  summary?: Record<string, unknown>;
};

type WorkflowIndex = {
  schemaVersion: string;
  runs: WorkflowTraceEntry[];
};

function loadWorkflowIndex(filePath: string): WorkflowIndex {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WorkflowIndex;
    if (!parsed || !Array.isArray(parsed.runs)) throw new Error("invalid");
    return parsed;
  } catch {
    return { schemaVersion: "1.0", runs: [] };
  }
}

function writeWorkflowIndex(filePath: string, index: WorkflowIndex) {
  writeRunIndex(filePath, index as unknown as Record<string, unknown>);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function listJsonFiles(dir: string, prefix?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => (prefix ? file.startsWith(prefix) : true))
    .sort();
}

function writeJsonl(filePath: string, items: unknown[]) {
  const lines = items.map((item) => JSON.stringify(item));
  const body = lines.length ? `${lines.join("\n")}\n` : "";
  fs.writeFileSync(filePath, body);
}

export function resolveWorkflowDataDir(input?: string): string {
  const dir = input || process.env.WORKFLOW_LOCAL_DATA_DIR || ".next/workflow-data";
  return path.resolve(process.cwd(), dir);
}

export function recordWorkflowRun(entry: WorkflowTraceEntry, outputDir?: string, runId?: string) {
  const resolved = resolveRunDir(outputDir, runId);
  const runDir = resolved.runDir;
  const workflowsDir = path.join(runDir, "workflows");
  ensureDir(workflowsDir);

  const indexPath = path.join(workflowsDir, "index.json");
  const index = loadWorkflowIndex(indexPath);

  const exists = index.runs.some((r) => r.workflowRunId === entry.workflowRunId);
  if (!exists) {
    index.runs.push({
      ...entry,
      createdAt: entry.createdAt || new Date().toISOString(),
    });
  }

  writeWorkflowIndex(indexPath, index);
}

export type CaptureStoryTraceInput = {
  workflowRunId: string;
  apiBaseUrl: string;
  apiKey: string;
  projectId: string;
  outputDir?: string;
  runId?: string;
  caseId?: string;
  source?: string;
};

export async function captureStoryTrace(input: CaptureStoryTraceInput): Promise<void> {
  if (!input.apiBaseUrl) throw new Error("apiBaseUrl_required");
  if (!input.apiKey) throw new Error("apiKey_required");
  if (!input.projectId) throw new Error("projectId_required");

  const resolved = resolveRunDir(input.outputDir, input.runId);
  const runDir = resolved.runDir;
  const workflowsDir = path.join(runDir, "workflows");
  const eventsDir = path.join(workflowsDir, "events");
  ensureDir(eventsDir);

  const url = new URL("/api/story/traces/machine/events", input.apiBaseUrl);
  url.searchParams.set("workflowRunId", input.workflowRunId);
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("limit", "20000");

  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${input.apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`trace_fetch_failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as any;
  if (!json || json.ok !== true) {
    throw new Error(`trace_fetch_failed: ${JSON.stringify(json)}`);
  }

  const events = Array.isArray(json.events) ? json.events : [];
  const eventsPath = path.join(eventsDir, `${input.workflowRunId}.jsonl`);
  const stream = fs.createWriteStream(eventsPath, { flags: "w" });
  for (const ev of events) {
    stream.write(`${JSON.stringify(ev)}\n`);
  }
  stream.end();

  recordWorkflowRun(
    {
      workflowRunId: input.workflowRunId,
      source: input.source || "story",
      caseId: input.caseId,
      projectId: input.projectId,
      eventsPath: path.relative(runDir, eventsPath),
      summary: json.summary || undefined,
    },
    input.outputDir,
    input.runId
  );
}

export type CaptureLocalWorkflowTraceInput = {
  workflowRunId: string;
  dataDir?: string;
  outputDir?: string;
  runId?: string;
  caseId?: string;
  source?: string;
};

export function captureLocalWorkflowTrace(input: CaptureLocalWorkflowTraceInput): void {
  const resolved = resolveRunDir(input.outputDir, input.runId);
  const runDir = resolved.runDir;
  const workflowsRoot = path.join(runDir, "workflows");
  const workflowDir = path.join(workflowsRoot, input.workflowRunId);
  ensureDir(workflowDir);

  const dataDir = resolveWorkflowDataDir(input.dataDir);
  if (!fs.existsSync(dataDir)) {
    throw new Error(`workflow_data_dir_not_found:${dataDir}`);
  }

  let runRecord: Record<string, unknown> | undefined;
  const runPath = path.join(dataDir, "runs", `${input.workflowRunId}.json`);
  if (fs.existsSync(runPath)) {
    runRecord = readJsonFile<Record<string, unknown>>(runPath);
    if (runRecord) {
      fs.writeFileSync(path.join(workflowDir, "run.json"), JSON.stringify(runRecord, null, 2));
    }
  }

  const eventsDir = path.join(dataDir, "events");
  const eventFiles = listJsonFiles(eventsDir, `${input.workflowRunId}-`);
  const events = eventFiles
    .map((file) => readJsonFile<Record<string, unknown>>(path.join(eventsDir, file)))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const eventsPath = path.join(workflowDir, "events.jsonl");
  writeJsonl(eventsPath, events);

  const stepsDir = path.join(dataDir, "steps");
  const stepFiles = listJsonFiles(stepsDir, `${input.workflowRunId}-`);
  const steps = stepFiles
    .map((file) => readJsonFile<Record<string, unknown>>(path.join(stepsDir, file)))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const stepsPath = path.join(workflowDir, "steps.jsonl");
  writeJsonl(stepsPath, steps);

  const hooksDir = path.join(dataDir, "hooks");
  const hookFiles = listJsonFiles(hooksDir);
  const hooks = hookFiles
    .map((file) => readJsonFile<Record<string, unknown>>(path.join(hooksDir, file)))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => entry.runId === input.workflowRunId);
  const hooksPath = path.join(workflowDir, "hooks.jsonl");
  writeJsonl(hooksPath, hooks);

  const streamsRoot = path.join(dataDir, "streams");
  const streamsRunPath = path.join(streamsRoot, "runs", `${input.workflowRunId}.json`);
  let streamsPath: string | undefined;
  if (fs.existsSync(streamsRunPath)) {
    const streamsDir = path.join(workflowDir, "streams");
    ensureDir(streamsDir);
    const streamIndex = readJsonFile<Record<string, unknown>>(streamsRunPath);
    const indexPath = path.join(streamsDir, "streams.json");
    if (streamIndex) {
      fs.writeFileSync(indexPath, JSON.stringify(streamIndex, null, 2));
      streamsPath = indexPath;
    }
  }

  recordWorkflowRun(
    {
      workflowRunId: input.workflowRunId,
      source: input.source || "local",
      caseId: input.caseId,
      createdAt: (runRecord?.createdAt as string | undefined) || undefined,
      runPath: runRecord ? path.relative(runDir, path.join(workflowDir, "run.json")) : undefined,
      eventsPath: path.relative(runDir, eventsPath),
      stepsPath: path.relative(runDir, stepsPath),
      hooksPath: path.relative(runDir, hooksPath),
      streamsPath: streamsPath ? path.relative(runDir, streamsPath) : undefined,
      summary: runRecord
        ? {
            workflowName: runRecord.workflowName,
            status: runRecord.status,
            startedAt: runRecord.startedAt,
            completedAt: runRecord.completedAt,
          }
        : undefined,
    },
    input.outputDir,
    input.runId
  );
}
