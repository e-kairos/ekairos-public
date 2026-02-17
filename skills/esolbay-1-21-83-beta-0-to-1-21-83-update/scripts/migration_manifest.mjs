#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const fromVersion = arg("from", "1.0.5");
  const toVersion = arg("to", "1.0.6");
  const out = arg("out");
  const runId = arg("run-id", `mig-${Date.now()}`);

  if (!out) {
    throw new Error("usage: migration_manifest.mjs --out <file> [--from 1.0.5 --to 1.0.6 --run-id id]");
  }

  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    migration: {
      fromVersion,
      toVersion,
      scope: "story-deprecated-to-thread-package",
      goals: [
        "replace deprecated story usage",
        "adopt @ekairos/thread APIs",
        "ship migration scripts with audit trail",
      ],
    },
    artifacts: {
      preflight: "artifacts/preflight/scan.json",
      sourceDataset: "artifacts/datasets/source.json",
      transformedDataset: "artifacts/transformed/target.json",
      verifyReport: "artifacts/reports/verify.json",
      auditDir: ".migration-audit",
    },
    rollout: {
      strategy: "canary-by-org",
      initialWave: 1,
      requireDryRun: true,
      requireVerify: true,
    },
  };

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Migration manifest written: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
