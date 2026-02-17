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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function ensureJson(file, fallback) {
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2), "utf8");
  }
}

async function main() {
  const root = arg("root", process.cwd());
  const fromVersion = arg("from", "");
  const toVersion = arg("to", "");
  const runId = arg("run-id", `mig-${Date.now()}`);

  const artifactsDir = path.join(root, "artifacts");
  const dirs = [
    path.join(artifactsDir, "preflight"),
    path.join(artifactsDir, "datasets"),
    path.join(artifactsDir, "transformed"),
    path.join(artifactsDir, "reports"),
    path.join(root, ".migration-audit"),
    path.join(root, "queries"),
  ];
  for (const dir of dirs) await ensureDir(dir);

  await ensureJson(path.join(root, "queries", "source.json"), {
    // Fill with source query set
  });
  await ensureJson(path.join(root, "queries", "verify.json"), {
    // Fill with verification query set
  });
  await ensureJson(path.join(artifactsDir, "manifest.json"), {
    runId,
    fromVersion,
    toVersion,
    createdAt: new Date().toISOString(),
    scope: "story->thread migration",
  });

  const summary = {
    ok: true,
    root,
    runId,
    fromVersion,
    toVersion,
    createdAt: new Date().toISOString(),
    dirsCreated: dirs,
  };
  await fs.writeFile(path.join(artifactsDir, "bootstrap.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
