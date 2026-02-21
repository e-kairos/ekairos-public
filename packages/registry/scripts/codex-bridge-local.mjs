import http from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.CODEX_BRIDGE_PORT || "4310");

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function asString(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isValidCodexThreadId(value) {
  const normalized = asString(value).trim();
  if (!normalized) return false;
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true;
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true;
  return false;
}

const isWindows = process.platform === "win32";
const child = isWindows
  ? spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "codex app-server"],
      {
        stdio: ["pipe", "pipe", "inherit"],
        env: process.env,
      },
    )
  : spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });

const rl = createInterface({ input: child.stdout });
const pending = new Map();
const subscribers = new Set();
const watchers = new Set();
let bridgeInitialized = false;
let bridgeInitError = null;

function notifyAll(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(data);
    } catch {
      subscribers.delete(res);
    }
  }
  for (const watcher of watchers) {
    try {
      watcher(payload);
    } catch {
      // no-op
    }
  }
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg && msg.id && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timer);
    if (msg.error !== undefined && msg.error !== null) {
      const rpcError = asRecord(msg.error);
      reject(new Error(asString(rpcError.message) || asString(msg.error) || "rpc_error"));
      return;
    }
    resolve(msg);
    return;
  }
  notifyAll(msg);
});

function sendRpc(payload, timeoutMs = 60_000) {
  const id = payload.id ?? randomUUID();
  const msg = { ...payload, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc_timeout:${asString(payload.method)}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

function subscribeEvents(handler) {
  watchers.add(handler);
  return () => watchers.delete(handler);
}

async function initialize() {
  await sendRpc({
    method: "initialize",
    params: {
      clientInfo: { name: "ekairos-registry", version: "1.0.0" },
      capabilities: {},
    },
  });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
}

async function ensureInitialized() {
  if (bridgeInitialized) return;
  await initialize();
  bridgeInitialized = true;
  bridgeInitError = null;
}

async function runTurn(body) {
  const payload = asRecord(body);
  const instruction = asString(payload.instruction).trim();
  const config = asRecord(payload.config);
  const runtime = asRecord(payload.runtime);
  const requestedThreadId = asString(config.threadId).trim();
  const repoPath = asString(config.repoPath).trim() || process.cwd();
  const model = asString(config.model).trim();
  const approvalPolicy = asString(config.approvalPolicy).trim() || "never";
  const incomingSandboxPolicy = asRecord(config.sandboxPolicy);
  const sandboxPolicy =
    Object.keys(incomingSandboxPolicy).length > 0
      ? incomingSandboxPolicy
      : { type: "externalSandbox", networkAccess: "enabled" };

  let threadId = requestedThreadId;
  if (threadId && isValidCodexThreadId(threadId)) {
    await sendRpc({ method: "thread/resume", params: { threadId } });
  } else {
    threadId = "";
    const startParams = { cwd: repoPath, approvalPolicy, sandboxPolicy };
    if (model) startParams.model = model;
    const startRes = await sendRpc({ method: "thread/start", params: startParams });
    threadId =
      asString(asRecord(asRecord(startRes.result).thread).id) ||
      asString(asRecord(startRes.result).id) ||
      asString(asRecord(startRes).threadId);
  }
  if (!threadId) throw new Error("thread_id_missing");

  const stream = [];
  let assistantText = "";
  let reasoningText = "";
  let diff = "";
  let usage = {};
  let turnId = "";

  let resolveStartedTurn = null;
  const startedTurnPromise = new Promise((resolve) => {
    resolveStartedTurn = resolve;
  });

  const completedTurnPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("turn_completion_timeout"));
    }, 180_000);

    const unsubscribe = subscribeEvents((evt) => {
      const method = asString(evt.method);
      if (!method || method.startsWith("codex/event/")) return;

      const params = asRecord(evt.params);
      const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id);
      const evtThreadId = asString(params.threadId) || asString(asRecord(params.turn).threadId);

      if (method === "turn/started") {
        const startedId = asString(asRecord(params.turn).id) || evtTurnId;
        if (!turnId && startedId && evtThreadId === threadId && resolveStartedTurn) {
          turnId = startedId;
          resolveStartedTurn(startedId);
          resolveStartedTurn = null;
        }
      }

      const scopedTurnId = turnId || evtTurnId;
      const scopedToTurn =
        (evtTurnId && scopedTurnId && evtTurnId === scopedTurnId) ||
        (evtThreadId && evtThreadId === threadId) ||
        method.startsWith("thread/");
      if (!scopedToTurn) return;

      stream.push(evt);

      if (method === "item/agentMessage/delta") {
        assistantText += asString(params.delta);
      }
      if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
        reasoningText += asString(params.delta);
      }
      if (method === "turn/diff/updated") {
        diff = asString(params.diff);
      }
      if (method === "thread/tokenUsage/updated") {
        usage = asRecord(params.tokenUsage);
      }
      if (method === "item/completed") {
        const item = asRecord(params.item);
        if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
          assistantText = asString(item.text);
        }
        if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
          reasoningText = asString(item.summary);
        }
      }
      if (method === "turn/completed") {
        const turnData = asRecord(params.turn);
        const completedTurnId = asString(turnData.id);
        if (completedTurnId && turnId && completedTurnId !== turnId) return;
        const completedItems = asArray(turnData.items);
        for (const rawItem of completedItems) {
          const item = asRecord(rawItem);
          if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
            assistantText = asString(item.text);
          }
          if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
            reasoningText = asString(item.summary);
          }
        }
        clearTimeout(timeout);
        unsubscribe();
        resolve(turnData);
      }
    });
  });

  const turnStartParams = {
    threadId,
    input: [{ type: "text", text: instruction || "" }],
    cwd: repoPath,
    approvalPolicy,
    sandboxPolicy,
  };
  if (model) turnStartParams.model = model;
  const turnStartRes = await sendRpc({ method: "turn/start", params: turnStartParams });
  const turnResult = asRecord(turnStartRes.result);
  const turn = asRecord(turnResult.turn);
  turnId = asString(turn.id) || asString(turnResult.turnId) || asString(turnResult.id);
  if (!turnId) {
    turnId = await Promise.race([
      startedTurnPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("turn_started_timeout")), 20_000)),
    ]);
  }

  const completedTurn = await completedTurnPromise;
  return {
    threadId,
    turnId,
    assistantText,
    reasoningText,
    diff,
    usage,
    stream,
    metadata: {
      provider: "codex-app-server",
      runtime,
      completedTurn,
    },
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
    subscribers.add(res);
    req.on("close", () => subscribers.delete(res));
    return;
  }

  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        return;
      }
      try {
        await ensureInitialized();
        const response = await sendRpc(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (err) {
        bridgeInitError = err;
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: String(err?.message || err),
            detail: "codex_bridge_not_initialized",
          }),
        );
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/turn") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        return;
      }
      try {
        await ensureInitialized();
        const result = await runTurn(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        bridgeInitError = err;
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: String(err?.message || err),
            detail: "codex_turn_failed",
          }),
        );
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

child.on("error", (err) => {
  console.error("codex spawn failed", err);
});

child.on("exit", () => {
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", async () => {
  try {
    await ensureInitialized();
    console.log(`[codex-bridge] listening on http://127.0.0.1:${PORT}`);
  } catch (error) {
    bridgeInitError = error;
    console.error("[codex-bridge] initialize failed; bridge will stay up and retry per request", error);
    console.log(`[codex-bridge] listening on http://127.0.0.1:${PORT}`);
  }
});
