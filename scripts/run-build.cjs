const { spawn } = require("node:child_process");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_FORCE_KILL_DELAY_MS = 10 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const DEFAULT_EXCLUDED_FILTERS = [
  "--filter=!registry",
  "--filter=!thread-elements",
  "--filter=!@ekairos/thread-workflow-smoke",
  "--filter=!@ekairos/structure-workflow-smoke",
];

function parseTimeout()
{
  const timeoutEnv = process.env.BUILD_TIMEOUT_MS;
  if (timeoutEnv == null)
  {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsedTimeout = Number(timeoutEnv);
  if (Number.isNaN(parsedTimeout))
  {
    console.warn("[build] Ignoring BUILD_TIMEOUT_MS because it is not a number:", timeoutEnv);
    return DEFAULT_TIMEOUT_MS;
  }

  if (parsedTimeout <= 0)
  {
    console.warn("[build] Ignoring BUILD_TIMEOUT_MS because it must be positive:", timeoutEnv);
    return DEFAULT_TIMEOUT_MS;
  }

  return parsedTimeout;
}

function collectExtraArgs()
{
  const turboArgsEnv = process.env.TURBO_BUILD_ARGS;
  const extraArgs = [...DEFAULT_EXCLUDED_FILTERS];

  if (turboArgsEnv == null)
  {
    return extraArgs;
  }

  const trimmed = turboArgsEnv.trim();
  if (trimmed.length === 0)
  {
    return extraArgs;
  }

  const tokens = trimmed.split(/\s+/u);
  for (const token of tokens)
  {
    extraArgs.push(token);
  }

  return extraArgs;
}

function resolveTurboExecutable()
{
  let packageJsonPath;
  try
  {
    packageJsonPath = require.resolve("turbo/package.json");
  }
  catch (error)
  {
    console.error("[build] Could not resolve turbo package. Is it installed?", error);
    process.exit(1);
  }

  const turboPackage = require(packageJsonPath);
  let binRelative = null;

  if (typeof turboPackage.bin === "string")
  {
    binRelative = turboPackage.bin;
  }
  else if (turboPackage.bin != null && Object.prototype.hasOwnProperty.call(turboPackage.bin, "turbo"))
  {
    binRelative = turboPackage.bin.turbo;
  }

  if (binRelative == null)
  {
    console.error("[build] Unable to find turbo binary path in package.json bin field.");
    process.exit(1);
  }

  const packageDir = path.dirname(packageJsonPath);
  const executablePath = path.resolve(packageDir, binRelative);
  return executablePath;
}

function logHeartbeat(startTime)
{
  const elapsedMs = Date.now() - startTime;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  console.log(`[build] Still running... ${elapsedSeconds} seconds elapsed.`);
}

function main()
{
  const timeoutMs = parseTimeout();
  const extraArgs = collectExtraArgs();
  const turboExecutable = resolveTurboExecutable();
  const turboArgs = [
    turboExecutable,
    "build",
    "--output-logs=full",
    "--log-order=stream"
  ];

  if (extraArgs.length > 0)
  {
    for (const arg of extraArgs)
    {
      turboArgs.push(arg);
    }
  }

  const startTime = Date.now();
  console.log(`[build] Starting turbo build at ${new Date(startTime).toISOString()}`);
  console.log(`[build] Command: ${process.execPath} ${turboArgs.join(" ")}`);
  console.log(`[build] Timeout set to ${timeoutMs} ms`);

  const childProcess = spawn(process.execPath, turboArgs, {
    stdio: "inherit",
    env: process.env,
  });

  let didTimeout = false;
  let forceKillHandle = null;

  function scheduleForceKill()
  {
    forceKillHandle = setTimeout(() =>
    {
      console.error("[build] Turbo process did not exit after timeout. Sending SIGKILL.");
      childProcess.kill("SIGKILL");
    }, DEFAULT_FORCE_KILL_DELAY_MS);
  }

  const timeoutHandle = setTimeout(() =>
  {
    didTimeout = true;
    console.error(`[build] Timeout reached after ${timeoutMs} ms. Sending SIGTERM to turbo process.`);
    const didSendSignal = childProcess.kill("SIGTERM");
    if (!didSendSignal)
    {
      console.error("[build] Failed to send SIGTERM. Forcing process exit immediately.");
      childProcess.kill("SIGKILL");
    }
    else
    {
      scheduleForceKill();
    }
  }, timeoutMs);

  const heartbeatHandle = setInterval(() =>
  {
    logHeartbeat(startTime);
  }, HEARTBEAT_INTERVAL_MS);

  function cleanupTimers()
  {
    clearTimeout(timeoutHandle);
    clearInterval(heartbeatHandle);
    if (forceKillHandle != null)
    {
      clearTimeout(forceKillHandle);
    }
  }

  function handleExit(exitCode, exitSignal)
  {
    cleanupTimers();

    const durationMs = Date.now() - startTime;
    console.log(`[build] Turbo build finished after ${durationMs} ms.`);

    if (exitSignal != null)
    {
      console.warn(`[build] Process exited due to signal: ${exitSignal}`);
    }

    if (didTimeout)
    {
      console.error("[build] Build terminated because it exceeded the configured timeout.");
    }

    if (typeof exitCode === "number")
    {
      process.exit(exitCode);
      return;
    }

    if (exitSignal != null)
    {
      process.exit(1);
      return;
    }

    process.exit(0);
  }

  childProcess.on("error", (error) =>
  {
    cleanupTimers();
    console.error("[build] Failed to start turbo build:", error);
    process.exit(1);
  });

  childProcess.on("close", (code, signal) =>
  {
    handleExit(code, signal);
  });

  function forwardSignal(signal)
  {
    console.warn(`[build] Received ${signal}. Forwarding to turbo process.`);
    childProcess.kill(signal);
  }

  process.on("SIGINT", () =>
  {
    forwardSignal("SIGINT");
  });

  process.on("SIGTERM", () =>
  {
    forwardSignal("SIGTERM");
  });
}

main();

