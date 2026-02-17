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
  const queryFile = arg("query-file");
  const outFile = arg("out");
  const runId = arg("run-id", `run-${Date.now()}`);

  if (!orgId || !baseUrl || !queryFile || !outFile) {
    throw new Error("Missing required args: --org --base-url --query-file --out");
  }

  const queryRaw = await fs.readFile(queryFile, "utf8");
  const query = JSON.parse(queryRaw);
  await writeMigrationAudit({
    runId,
    script: "extract_domain_dataset",
    stage: "snapshot",
    orgId,
    envName,
    payload: { queryFile: path.resolve(queryFile), query },
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
      query,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Domain query failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const output = {
    meta: {
      orgId,
      envName,
      endpoint,
      createdAt: new Date().toISOString(),
      queryFile: path.resolve(queryFile),
    },
    payload,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(output, null, 2), "utf8");
  await writeMigrationAudit({
    runId,
    script: "extract_domain_dataset",
    stage: "final",
    orgId,
    envName,
    payload: { outFile: path.resolve(outFile), rows: Object.keys(payload?.data || {}).length },
  });
  console.log(`Dataset written: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
