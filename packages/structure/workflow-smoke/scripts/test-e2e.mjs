import net from "node:net";
import { spawnSync } from "node:child_process";

const PORT = 3011;

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

    // Listen on all interfaces to catch more cases (ipv4/ipv6 bindings).
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

  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
    { stdio: "inherit" },
  );

  return res.status === 0;
}

// Force Playwright to start webServer (avoid reuseExistingServer) + pipe logs.
if (!process.env.CI) process.env.CI = "1";

if (process.platform === "win32") {
  // On Windows, always attempt to free the port (idempotent) to avoid flaky detection/races.
  tryKillPortOnWindows(PORT);
  if (await isPortInUse(PORT)) {
    console.error(`[structure-workflow-smoke] Port ${PORT} is still in use after kill attempt.`);
    process.exit(1);
  }
} else if (await isPortInUse(PORT)) {
  console.error(
    `[structure-workflow-smoke] Port ${PORT} is in use. Free it manually and rerun pnpm test:e2e.`,
  );
  process.exit(1);
}

const extraArgs = process.argv.slice(2);

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", "playwright.config.ts", ...extraArgs],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" },
);

if (result.error) {
  console.error("[structure-workflow-smoke] Failed to run Playwright:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

