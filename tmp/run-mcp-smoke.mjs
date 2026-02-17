import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const esolbayDir = "C:\\Users\\aleja\\WebstormProjects\\esolbay-platform";
const baseUrl = "http://localhost:3010/.well-known/domain/mcp";
const mcpUrl = `${baseUrl}/mcp`;
const token = "dev-mcp-token";

const env = {
  ...process.env,
  EKAIROS_MCP_SIMPLE: "1",
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
  if (!child.killed) {
    child.kill("SIGTERM");
  }
};

process.on("exit", stopChild);
process.on("SIGINT", () => {
  stopChild();
  process.exit(1);
});

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetchWithTimeout(baseUrl, 2000);
      if (res.ok) return;
    } catch {}
    await wait(1000);
  }
  throw new Error("Server did not become ready");
}

function parseResponseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    const line = trimmed
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (line) {
      const payload = line.slice("data:".length).trim();
      return JSON.parse(payload);
    }
  }
  return JSON.parse(trimmed);
}

let sessionId = null;
const baseHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  Authorization: `Bearer ${token}`,
};

async function rpc(id, method, params) {
  const payload = { jsonrpc: "2.0", id, method, params };
  const headers = { ...baseHeaders };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const nextSessionId = res.headers.get("mcp-session-id");
  if (nextSessionId) sessionId = nextSessionId;
  if (!res.ok) {
    throw new Error(`[mcp] ${method} failed: ${res.status} ${text}`);
  }
  return parseResponseBody(text);
}

async function runSmoke() {
  console.log(`[mcp] connecting to ${mcpUrl}`);
  const init = await rpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ekairos-mcp-smoke", version: "0.1.0" },
  });
  console.log("[mcp] initialize result:");
  console.log(JSON.stringify(init, null, 2));

  const tools = await rpc(2, "tools/list", {});
  const toolNames = Array.isArray(tools?.result?.tools)
    ? tools.result.tools.map((t) => t.name)
    : [];
  console.log(`[mcp] tools: ${toolNames.join(", ") || "(none)"}`);

  if (!toolNames.includes("domain.getContext")) {
    throw new Error("domain.getContext tool not found");
  }

  const context = await rpc(3, "tools/call", {
    name: "domain.getContext",
    arguments: {},
  });
  console.log("[mcp] domain.getContext result:");
  console.log(JSON.stringify(context, null, 2));
}

try {
  await waitForServer();
  await runSmoke();
  console.log("[mcp] done");
} finally {
  stopChild();
}
