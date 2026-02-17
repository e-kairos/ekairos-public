import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const esolbayDir = "C:\\Users\\aleja\\WebstormProjects\\esolbay-platform";
const baseUrl = "http://localhost:3010/.well-known/domain/mcp";
const mcpUrl = `${baseUrl}/mcp`;
const token = "dev-mcp-token";

const env = {
  ...process.env,
  EKAIROS_MCP_DEBUG: "1",
  EKAIROS_MCP_TOKEN: token,
  EKAIROS_DOMAIN_TOKEN: token,
  PORT: "3010",
};

const child = spawn("pnpm", ["dev"], {
  cwd: esolbayDir,
  env,
  stdio: "inherit",
  shell: true,
});

const stopChild = () => {
  if (!child.killed) child.kill("SIGTERM");
};

process.on("exit", stopChild);
process.on("SIGINT", () => {
  stopChild();
  process.exit(1);
});

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetchWithTimeout(baseUrl, {}, 2000);
      if (res.ok) return;
    } catch {}
    await wait(1000);
  }
  throw new Error("Server did not become ready");
}

async function postRpc(method, id) {
  const res = await fetchWithTimeout(
    mcpUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }),
    },
    7000,
  );
  const text = await res.text();
  console.log(`[client] ${method} status`, res.status);
  console.log(text.slice(0, 2000));
}

try {
  await waitForServer();
  await postRpc("initialize", 1);
  await postRpc("tools/list", 2);
} catch (err) {
  console.error("[client] error", err?.name || err, err?.message || "");
  process.exitCode = 1;
} finally {
  stopChild();
}
