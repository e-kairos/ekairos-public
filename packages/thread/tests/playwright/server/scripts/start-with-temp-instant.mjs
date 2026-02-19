import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const smokeDir = resolve(__dirname, "..");
const repoRoot = resolve(smokeDir, "..", "..", "..", "..", "..");
const envPath = resolve(smokeDir, ".env.local");
const schemaPath = resolve(smokeDir, "instant.schema.ts");

// Load env from the server folder and repo root.
dotenvConfig({ path: resolve(smokeDir, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(smokeDir, ".env"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env"), quiet: true });

function parseJsonOutput(output) {
  const raw = String(output ?? "");
  const text = raw.trim();
  if (!text) {
    throw new Error("instant-cli returned empty output");
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonText = raw.slice(start, end + 1);
    return JSON.parse(jsonText);
  }
  throw new Error("instant-cli output is not valid JSON");
}

function resolveInstantCliBin() {
  const bin = process.platform === "win32" ? "instant-cli.cmd" : "instant-cli";
  return resolve(repoRoot, "node_modules", ".bin", bin);
}

function runInstantCli(args, options = {}) {
  const binPath = resolveInstantCliBin();
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd" : binPath;
  const cmdArgs = isWin ? ["/c", binPath, ...args] : args;
  const res = spawnSync(cmd, cmdArgs, {
    cwd: smokeDir,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf-8",
    stdio: options.stdio ?? "pipe",
  });
  if (res.error) {
    throw res.error;
  }
  if (typeof res.status === "number" && res.status !== 0) {
    const stderr = res.stderr ? String(res.stderr).trim() : "";
    throw new Error(`instant-cli failed (${res.status}): ${stderr}`);
  }
  return res;
}

function ensureWorkspaceBuild() {
  const packagesToCheck = [
    { dir: "domain", file: "index.js" },
    { dir: "story", file: "index.js" },
  ];

  const needsBuild = packagesToCheck.some((pkg) => {
    const distPath = resolve(repoRoot, "packages", pkg.dir, "dist", pkg.file);
    return !existsSync(distPath);
  });

  if (!needsBuild) return;

  const isWin = process.platform === "win32";
  const buildArgs = ["--filter", "@ekairos/domain", "--filter", "@ekairos/thread", "build"];

  const res = spawnSync("pnpm", buildArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
  });
  if (res.error) throw res.error;
  if (typeof res.status === "number" && res.status !== 0) {
    throw new Error(`pnpm build failed (${res.status})`);
  }
}

function createTempInstantApp() {
  const initRes = runInstantCli([
    "init-without-files",
    "--title",
    "story-workflow-smoke",
    "--temp",
  ]);
  const payload = parseJsonOutput(initRes.stdout);
  if (payload?.error) {
    throw new Error(`instant-cli init error: ${payload.error}`);
  }
  const appId = String(payload?.appId ?? payload?.app?.appId ?? "").trim();
  const adminToken = String(payload?.adminToken ?? payload?.app?.adminToken ?? "").trim();
  if (!appId || !adminToken) {
    throw new Error("instant-cli init did not return appId/adminToken");
  }

  const envText = [
    `NEXT_PUBLIC_INSTANT_APP_ID=${appId}`,
    `INSTANT_APP_ID=${appId}`,
    `INSTANTDB_APP_ID=${appId}`,
    `INSTANT_APP_ADMIN_TOKEN=${adminToken}`,
    `INSTANT_ADMIN_TOKEN=${adminToken}`,
    `INSTANTDB_ADMIN_TOKEN=${adminToken}`,
    `STORY_SMOKE_APP_CREATED_AT=${new Date().toISOString()}`,
  ].join("\n");
  writeFileSync(envPath, `${envText}\n`, "utf-8");

  return { appId, adminToken };
}

function pushSchema(creds) {
  ensureWorkspaceBuild();
  runInstantCli(
    ["push", "schema", "--app", creds.appId, "--token", creds.adminToken, "--yes", "--package", "admin"],
    { env: { INSTANT_SCHEMA_FILE_PATH: schemaPath }, stdio: "inherit" },
  );
}

function readExistingEnv() {
  try {
    const raw = readFileSync(envPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const map = new Map();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      map.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
    }
    const appId = map.get("NEXT_PUBLIC_INSTANT_APP_ID") || map.get("INSTANT_APP_ID");
    const adminToken = map.get("INSTANT_APP_ADMIN_TOKEN") || map.get("INSTANT_ADMIN_TOKEN");
    if (appId && adminToken) {
      return { appId, adminToken };
    }
  } catch {
    // ignore
  }
  return null;
}

function parsePortArg() {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--port");
  if (idx >= 0 && args[idx + 1]) {
    return String(args[idx + 1]);
  }
  return "3012";
}

const existing = readExistingEnv();
let creds = existing ?? createTempInstantApp();
try {
  pushSchema(creds);
} catch (err) {
  console.warn("[story-workflow-smoke] Failed to push schema; recreating temp app.");
  creds = createTempInstantApp();
  pushSchema(creds);
}
const port = parsePortArg();

const nextArgs = ["exec", "next", "dev", "--port", port];
const nextProc = spawn("pnpm", nextArgs, {
  cwd: smokeDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_INSTANT_APP_ID: creds.appId,
    INSTANT_APP_ID: creds.appId,
    INSTANTDB_APP_ID: creds.appId,
    INSTANT_APP_ADMIN_TOKEN: creds.adminToken,
    INSTANT_ADMIN_TOKEN: creds.adminToken,
    INSTANTDB_ADMIN_TOKEN: creds.adminToken,
  },
  shell: process.platform === "win32",
});

const shutdown = (signal) => {
  if (!nextProc.killed) {
    nextProc.kill(signal);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

nextProc.on("exit", (code) => {
  process.exit(code ?? 0);
});
