#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "scripts", "release-required-checks.json");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const printable = `${command} ${args.join(" ")}`;
  console.log(`$ ${printable}`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: rootDir,
    env: process.env,
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Required check failed (${result.status}): ${printable}`);
  }
}

if (!fs.existsSync(configPath)) {
  fail(`Missing config file: ${configPath}`);
}

const raw = fs.readFileSync(configPath, "utf8");
const parsed = JSON.parse(raw);
const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];

if (checks.length === 0) {
  fail("No checks configured in scripts/release-required-checks.json");
}

for (const check of checks) {
  const name = typeof check?.name === "string" ? check.name.trim() : "";
  const command = typeof check?.command === "string" ? check.command.trim() : "";
  const args = Array.isArray(check?.args) ? check.args.map((value) => String(value)) : [];

  if (!name || !command) {
    fail(`Invalid required check entry: ${JSON.stringify(check)}`);
  }

  console.log(`Running required check: ${name}`);
  run(command, args);
}

console.log("All required release checks passed.");
