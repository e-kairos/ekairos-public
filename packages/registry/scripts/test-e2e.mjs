import net from "node:net";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const PORT = 3030;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const registryDir = resolve(__dirname, "..");
const workspaceRoot = resolve(registryDir, "..", "..");

dotenvConfig({ path: resolve(registryDir, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(registryDir, ".env"), quiet: true });
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true });

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

    server.listen(port);
  });
}

function tryKillPortOnWindows(port) {
  const psCommand =
    "$procIds = @(" +
    `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ` +
    "Select-Object -ExpandProperty OwningProcess | " +
    "Where-Object { $_ -gt 0 } | " +
    "Select-Object -Unique" +
    "); " +
    "if ($procIds.Count -gt 0) { foreach ($procId in $procIds) { Stop-Process -Id $procId -Force } }";

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
    { stdio: "inherit" },
  );

  return result.status === 0;
}

if (!process.env.CI) process.env.CI = "1";

if (process.platform === "win32") {
  tryKillPortOnWindows(PORT);
  if (await isPortInUse(PORT)) {
    console.error(`[registry-e2e] Port ${PORT} is still in use after kill attempt.`);
    process.exit(1);
  }
} else if (await isPortInUse(PORT)) {
  console.error(`[registry-e2e] Port ${PORT} is in use. Free it and rerun test.`);
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", "playwright.config.ts", ...extraArgs],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

if (result.error) {
  console.error("[registry-e2e] Failed to run Playwright:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
