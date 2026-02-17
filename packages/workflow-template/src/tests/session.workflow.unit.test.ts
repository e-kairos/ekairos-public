/* @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { queryDomain, transform } from "../session.workflow";

type DomainServerState = {
  baseUrl: string;
  close: () => Promise<void>;
  getLastRequest: () => { auth?: string; body?: any };
};

async function startDomainServer(rows: Array<Record<string, unknown>>): Promise<DomainServerState> {
  let lastRequest: { auth?: string; body?: any } = {};

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const { url, method } = req;
    if (method !== "POST" || url !== "/.well-known/ekairos/v1/domain") {
      res.statusCode = 404;
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        lastRequest = {
          auth: req.headers.authorization,
          body: body ? JSON.parse(body) : {},
        };
      } catch {
        lastRequest = { auth: req.headers.authorization };
      }

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

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test domain server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
    getLastRequest: () => lastRequest,
  };
}

describe("workflow-template tools", () => {
  let server: DomainServerState;

  beforeAll(async () => {
    server = await startDomainServer([
      { id: "req-1", total: 120, status: "approved" },
      { id: "req-2", total: 80, status: "draft" },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it("queryDomain hits the domain endpoint and returns data", async () => {
    const result = await queryDomain({
      baseUrl: server.baseUrl,
      token: "test-token",
      orgId: "org-1",
      query: { requisitions: { $: { limit: 10 } } },
    });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);

    const lastRequest = server.getLastRequest();
    expect(lastRequest.auth).toBe("Bearer test-token");
    expect(lastRequest.body).toEqual({
      orgId: "org-1",
      query: { requisitions: { $: { limit: 10 } } },
    });
  });

  it("transform runs a custom program over rows", async () => {
    const result = await transform({
      rows: [
        { id: "req-1", total: 120, status: "approved" },
        { id: "req-2", total: 80, status: "draft" },
      ],
      program: "return rows.filter((row) => row.total >= 100);",
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: "req-1", total: 120, status: "approved" }]);
  });
});
