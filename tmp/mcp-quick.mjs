import { setTimeout as wait } from "node:timers/promises";

const url = "http://localhost:3010/.well-known/domain/mcp/mcp";
const headers = {
  "content-type": "application/json",
  accept: "application/json",
  authorization: "Bearer dev-mcp-token",
};

async function call(method, id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

try {
  const init = await call("initialize", 1);
  console.log("init", init.status, init.text);
  await wait(200);
  const list = await call("tools/list", 2);
  console.log("list", list.status, list.text);
} catch (err) {
  console.error("error", err?.name || err, err?.message || "");
  process.exit(1);
}
