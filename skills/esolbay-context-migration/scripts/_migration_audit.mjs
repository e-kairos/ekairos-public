import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function nowIso() {
  return new Date().toISOString();
}

export async function writeMigrationAudit(params) {
  const runId = String(params.runId || `run-${Date.now()}`);
  const record = {
    runId,
    script: String(params.script || "unknown"),
    stage: String(params.stage || "unknown"),
    createdAt: nowIso(),
    orgId: String(params.orgId || ""),
    envName: String(params.envName || ""),
    payload: params.payload ?? null,
  };

  const dir = ".migration-audit";
  const file = path.join(
    dir,
    `${record.runId}.${record.script}.${record.stage}.json`,
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return record;
}
