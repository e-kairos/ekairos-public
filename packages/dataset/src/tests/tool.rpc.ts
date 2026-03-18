import http from "node:http"

type JsonRecord = Record<string, unknown>

export type ToolRpcServer = {
  url: string
  close: () => Promise<void>
}

export async function startToolRpcServer(params: {
  tools: Record<string, { execute: (input: unknown) => Promise<unknown> }>
}): Promise<ToolRpcServer> {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/invoke") {
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "not_found" }))
      return
    }

    let body = ""
    request.on("data", (chunk) => {
      body += chunk.toString()
    })
    request.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}") as JsonRecord
        const toolName = String(payload.tool ?? "").trim()
        const tool = params.tools[toolName]
        if (!tool) {
          response.writeHead(404, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: "tool_not_found" }))
          return
        }

        const result = await tool.execute(payload.input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify(result))
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })

  const address = server.address()
  if (!address || typeof address !== "object") {
    throw new Error("tool_rpc_address_unavailable")
  }

  return {
    url: `http://127.0.0.1:${address.port}/invoke`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
