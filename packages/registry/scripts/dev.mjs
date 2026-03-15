import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bridgeScript = resolve(__dirname, "codex-bridge-local.mjs");

const bridgePort = Number(process.env.CODEX_BRIDGE_PORT || "4500");
const explicitAppServerUrl = String(process.env.CODEX_APP_SERVER_URL ?? "").trim();
const hasExplicitHttpAppServerUrl =
  explicitAppServerUrl.startsWith("http://") || explicitAppServerUrl.startsWith("https://");
const disableAutoBridge = process.env.CODEX_DISABLE_AUTO_BRIDGE === "1";
const realE2E = process.env.CODEX_REAL_E2E === "1";
const shouldAutoBridge = !disableAutoBridge && !realE2E && !hasExplicitHttpAppServerUrl;

const env = { ...process.env };
let bridgeChild = null;

async function isPortInUse(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") return resolve(true);
      return resolve(true);
    });

    server.once("listening", () => {
      server.close(() => resolve(false));
    });

    server.listen(port, "127.0.0.1");
  });
}

if (shouldAutoBridge && (await isPortInUse(bridgePort))) {
  process.stderr.write(
    `[registry-dev] port ${bridgePort} is already in use. Free it or set CODEX_APP_SERVER_URL explicitly.\n`,
  );
  process.exit(1);
}

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
