const baseUrl =
  process.env.MCP_URL || "http://localhost:3010/.well-known/domain/mcp/mcp";
const token = process.env.MCP_TOKEN ? String(process.env.MCP_TOKEN) : "";

const timeout = setTimeout(() => {
  console.error("[mcp] timeout waiting for MCP response");
  process.exit(1);
}, 30000);

const baseHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

let sessionId = null;

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

async function rpc(id, method, params) {
  const payload = { jsonrpc: "2.0", id, method, params };
  const headers = { ...baseHeaders };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(baseUrl, {
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

console.log(`[mcp] connecting to ${baseUrl}`);
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

clearTimeout(timeout);
console.log("[mcp] done");
