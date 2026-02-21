import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bridgeScript = resolve(__dirname, "codex-bridge-local.mjs");

const bridgePort = Number(process.env.CODEX_BRIDGE_PORT || "4310");
const explicitAppServerUrl = String(process.env.CODEX_APP_SERVER_URL ?? "").trim();
const hasExplicitHttpAppServerUrl =
  explicitAppServerUrl.startsWith("http://") || explicitAppServerUrl.startsWith("https://");
const disableAutoBridge = process.env.CODEX_DISABLE_AUTO_BRIDGE === "1";
const realE2E = process.env.CODEX_REAL_E2E === "1";
const shouldAutoBridge = !disableAutoBridge && !realE2E && !hasExplicitHttpAppServerUrl;

const env = { ...process.env };
let bridgeChild = null;

if (shouldAutoBridge) {
  bridgeChild = spawn(process.execPath, [bridgeScript], {
    stdio: "inherit",
    env: { ...process.env, CODEX_BRIDGE_PORT: String(bridgePort) },
  });
  env.CODEX_APP_SERVER_URL = `http://127.0.0.1:${bridgePort}/turn`;
  process.stdout.write(
    `[registry-dev] auto bridge enabled -> CODEX_APP_SERVER_URL=${env.CODEX_APP_SERVER_URL}\n`,
  );
} else {
  process.stdout.write(
    `[registry-dev] using explicit CODEX_APP_SERVER_URL=${explicitAppServerUrl || "(none)"}\n`,
  );
}

const nextChild = spawn("pnpm", ["exec", "next", "dev", "--port", "3030"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    nextChild.kill(signal);
  } catch {
    // no-op
  }
  if (bridgeChild) {
    try {
      bridgeChild.kill(signal);
    } catch {
      // no-op
    }
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

nextChild.on("exit", (code) => {
  if (bridgeChild) {
    try {
      bridgeChild.kill("SIGTERM");
    } catch {
      // no-op
    }
  }
  process.exit(code ?? 0);
});

if (bridgeChild) {
  bridgeChild.on("exit", (code) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      process.stderr.write("[registry-dev] codex bridge exited unexpectedly.\n");
    }
  });
}
