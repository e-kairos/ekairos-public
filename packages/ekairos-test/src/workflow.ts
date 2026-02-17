import fs from "node:fs";
import path from "node:path";

import { getRun, resumeHook } from "workflow/api";

import { resolveWorkflowDataDir } from "./story.js";

export type WorkflowHookRecord = {
  runId: string;
  hookId: string;
  token: string;
  ownerId?: string;
  projectId?: string;
  environment?: string;
  metadata?: unknown;
  createdAt?: string | Date;
  specVersion?: number;
};

export type AwaitHookParams = {
  token?: string;
  hookId?: string;
  runId?: string;
  dataDir?: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

function findHookInDir(params: {
  hooksDir: string;
  token?: string;
  hookId?: string;
  runId?: string;
}): WorkflowHookRecord | undefined {
  if (!fs.existsSync(params.hooksDir)) return undefined;

  if (params.hookId) {
    const hookPath = path.join(params.hooksDir, `${params.hookId}.json`);
    const hook = readJsonFile<WorkflowHookRecord>(hookPath);
    if (!hook) return undefined;
    if (params.token && hook.token !== params.token) return undefined;
    if (params.runId && hook.runId !== params.runId) return undefined;
    return hook;
  }

  for (const file of listJsonFiles(params.hooksDir)) {
    const hookPath = path.join(params.hooksDir, file);
    const hook = readJsonFile<WorkflowHookRecord>(hookPath);
    if (!hook) continue;
    if (params.token && hook.token !== params.token) continue;
    if (params.runId && hook.runId !== params.runId) continue;
    return hook;
  }

  return undefined;
}

function ensureSearchKey(params: AwaitHookParams) {
  if (!params.token && !params.hookId) {
    throw new Error("awaitHook requires token or hookId");
  }
}

export async function awaitHook(params: AwaitHookParams): Promise<WorkflowHookRecord> {
  ensureSearchKey(params);
  const dataDir = resolveWorkflowDataDir(params.dataDir);
  const hooksDir = path.join(dataDir, "hooks");
  const pollIntervalMs = Math.max(50, Number(params.pollIntervalMs ?? 200));

  while (true) {
    if (params.signal?.aborted) {
      throw new Error("awaitHook aborted");
    }
    const hook = findHookInDir({
      hooksDir,
      token: params.token,
      hookId: params.hookId,
      runId: params.runId,
    });
    if (hook) return hook;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export type TriggerHookParams = {
  token?: string;
  hookId?: string;
  runId?: string;
  data?: unknown;
  dataDir?: string;
  wait?: boolean | AwaitHookParams;
};

export async function triggerHook(params: TriggerHookParams): Promise<{
  hook?: WorkflowHookRecord;
  token: string;
}> {
  let hook: WorkflowHookRecord | undefined;
  const shouldWait = params.wait !== false;
  if (shouldWait) {
    const waitParams =
      params.wait && typeof params.wait === "object"
        ? params.wait
        : {
            token: params.token,
            hookId: params.hookId,
            runId: params.runId,
            dataDir: params.dataDir,
          };
    hook = await awaitHook(waitParams);
  }

  const token = params.token || hook?.token;
  if (!token) {
    throw new Error("triggerHook requires token or hookId");
  }

  await resumeHook(token, params.data ?? {});
  return { hook, token };
}

export type AwaitWorkflowCompletionParams = {
  runId: string;
};

export async function awaitWorkflowCompletion<TResult = unknown>(
  params: AwaitWorkflowCompletionParams,
): Promise<TResult> {
  const run = getRun<TResult>(params.runId);
  return await run.returnValue;
}

export type AwaitWorkflowStatusParams = {
  runId: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export async function awaitWorkflowStatus(
  params: AwaitWorkflowStatusParams,
): Promise<string> {
  const run = getRun(params.runId);
  const pollIntervalMs = Math.max(50, Number(params.pollIntervalMs ?? 200));
  while (true) {
    if (params.signal?.aborted) {
      throw new Error("awaitWorkflowStatus aborted");
    }
    const status = await run.status;
    if (["completed", "failed", "cancelled"].includes(String(status))) {
      return String(status);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
