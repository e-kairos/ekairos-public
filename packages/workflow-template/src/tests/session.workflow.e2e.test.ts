/* @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const execFileAsync = promisify(execFile);
const debug = process.env.WORKFLOW_TEMPLATE_DEBUG === "1";
const log = (...args: Array<unknown>) => {
  if (debug) {
    console.log("[workflow-template]", ...args);
  }
};

type DomainServerState = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function startDomainServer(rows: Array<Record<string, unknown>>): Promise<DomainServerState> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const { url, method } = req;
    if (method !== "POST" || url !== "/.well-known/ekairos/v1/domain") {
      res.statusCode = 404;
      res.end();
      return;
    }

    req.on("data", () => undefined);
    req.on("end", () => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          data: rows,
          truncated: false,
        }),
      );
    });
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test domain server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolveClose();
        });
      }),
  };
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toHeadersObject(headers: IncomingMessage["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    result[key] = Array.isArray(value) ? value.join(",") : value;
  }
  return result;
}

async function handleFetchHandler(
  handler: (req: Request) => Promise<Response>,
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
) {
  const body = await readRequestBody(req);
  const url = new URL(req.url || "/", baseUrl).toString();
  const request = new Request(url, {
    method: req.method,
    headers: toHeadersObject(req.headers),
    body: body.length ? body : undefined,
  });
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const responseBody = Buffer.from(await response.arrayBuffer());
  res.end(responseBody);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("workflow-template compile + run", () => {
  let server: DomainServerState;
  let dataDir: string;
  let workflowServer: ReturnType<typeof createServer> | null = null;
  let workflowBaseUrl = "";
  const packageRoot = resolve(__dirname, "..", "..");

  beforeAll(async () => {
    server = await startDomainServer([
      { id: "req-1", total: 120, status: "approved" },
      { id: "req-2", total: 80, status: "draft" },
    ]);
    dataDir = await mkdtemp(join(os.tmpdir(), "workflow-template-"));
    log("dataDir", dataDir);
  });

  afterAll(async () => {
    await server.close();
    if (workflowServer) {
      await new Promise<void>((resolveClose, reject) => {
        workflowServer?.close((err) => {
          if (err) reject(err);
          else resolveClose();
        });
      });
    }
    if (dataDir && !debug) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("compiles the workflow file and runs it in a local world", async () => {
    await execFileAsync("node", ["scripts/compile.mjs"], { cwd: packageRoot });

    const clientModulePath = join(packageRoot, "dist", "session.workflow.js");
    const workflowBundlePath = join(packageRoot, "dist", "workflow.bundle.js");
    const stepsBundlePath = join(packageRoot, "dist", "steps.bundle.js");

    const workflowCode = await readFile(workflowBundlePath, "utf8");
    const clientModuleUrl = pathToFileURL(clientModulePath).href;
    const module = await import(`${clientModuleUrl}?t=${Date.now()}`);

    await import(`${pathToFileURL(stepsBundlePath).href}?t=${Date.now()}`);

    const [{ createLocalWorld }, runtime, api] = await Promise.all([
      import("@workflow/world-local"),
      import("workflow/runtime"),
      import("workflow/api"),
    ]);
    const { setWorld, stepEntrypoint, workflowEntrypoint } = runtime;
    const { start } = api;

    let workflowHandler: ((req: Request) => Promise<Response>) | null = null;
    let stepHandler: ((req: Request) => Promise<Response>) | null = null;

    workflowServer = createServer(async (req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (!workflowHandler || !stepHandler) {
        res.statusCode = 503;
        res.end();
        return;
      }
      if (req.url.startsWith("/.well-known/workflow/v1/flow")) {
        log("flow request", req.url);
        await handleFetchHandler(workflowHandler, req, res, workflowBaseUrl);
        return;
      }
      if (req.url.startsWith("/.well-known/workflow/v1/step")) {
        log("step request", req.url);
        await handleFetchHandler(stepHandler, req, res, workflowBaseUrl);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolveListen) => {
      workflowServer?.listen(0, "127.0.0.1", resolveListen);
    });
    const workflowAddress = workflowServer.address();
    if (!workflowAddress || typeof workflowAddress === "string") {
      throw new Error("Failed to bind workflow server");
    }
    workflowBaseUrl = `http://127.0.0.1:${workflowAddress.port}`;
    log("workflow server", workflowBaseUrl);

    const world = createLocalWorld({ dataDir, baseUrl: workflowBaseUrl });
    await world.start();
    setWorld(world);

    workflowHandler = workflowEntrypoint(workflowCode);
    stepHandler = stepEntrypoint;

    const run = await start(module.runSession, [
      {
        orgId: "org-1",
        baseUrl: server.baseUrl,
        query: { requisitions: { $: { limit: 5 } } },
      },
    ]);
    log("run id", (run as { runId?: string }).runId);

    const result = await Promise.race([
      run.returnValue,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("workflow timeout waiting for returnValue")), 30000),
      ),
    ]);
    log("returnValue", result);
    const value =
      result && typeof result === "object" && "value" in (result as Record<string, unknown>)
        ? ((result as Record<string, unknown>).value as {
            ok: boolean;
            rows?: Array<Record<string, unknown>>;
          })
        : (result as { ok: boolean; rows?: Array<Record<string, unknown>> });

    expect(value.ok).toBe(true);
    expect(Array.isArray(value.rows)).toBe(true);
    expect(value.rows?.length).toBe(2);
  }, 120000);
});
