#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { writeMigrationAudit } from "./_migration_audit.mjs";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const orgId = arg("org", "");
  const envName = arg("env", "production");
  const baseUrl = arg("base-url", "");
  const token = arg("token", "");
  const verifyFile = arg("verify-file");
  const outFile = arg("out");
  const runId = arg("run-id", `run-${Date.now()}`);

  if (!orgId || !baseUrl || !verifyFile || !outFile) {
    throw new Error("Missing required args: --org --base-url --verify-file --out");
  }

  const verifyQuery = JSON.parse(await fs.readFile(verifyFile, "utf8"));
  await writeMigrationAudit({
    runId,
    script: "verify_migration",
    stage: "snapshot",
    orgId,
    envName,
    payload: { verifyFile: path.resolve(verifyFile), verifyQuery },
  });
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/.well-known/ekairos/v1/domain`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      org_id: orgId,
      env: envName,
      query: verifyQuery,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const report = {
    ok: response.ok,
    status: response.status,
    orgId,
    envName,
    endpoint,
    verifiedAt: new Date().toISOString(),
    payload,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
  await writeMigrationAudit({
    runId,
    script: "verify_migration",
    stage: "final",
    orgId,
    envName,
    payload: { outFile: path.resolve(outFile), ok: report.ok, status: report.status },
  });

  if (!response.ok) {
    throw new Error(`Verification failed (${response.status})`);
  }

  console.log(`Verification report written: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
