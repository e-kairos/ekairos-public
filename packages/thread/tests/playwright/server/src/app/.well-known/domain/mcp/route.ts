// @ekairos/domain-mcp-route
import * as __ekairosBootstrap from "../../../../ekairos.ts"
__ekairosBootstrap?.runtimeConfig?.setup?.()
import { NextResponse } from "next/server"

const hasRedis = Boolean(process.env.REDIS_URL || process.env.KV_URL)

export function GET() {
  const transports = hasRedis ? ["sse", "streamable_http"] : ["streamable_http"]
  const sse = hasRedis ? "/.well-known/domain/mcp/sse" : undefined
  return NextResponse.json({
    ok: true,
    transports,
    sse,
    streamableHttp: "/.well-known/domain/mcp/mcp",
  })
}
