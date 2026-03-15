// @ekairos/domain-mcp-route
import * as __ekairosBootstrap from "../../../../ekairos.ts"
__ekairosBootstrap?.runtimeConfig?.setup?.()
import { NextResponse } from "next/server"

const allowOrigin = "*";
const allowHeaders = "authorization, content-type";
const allowMethods = "GET, OPTIONS";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": allowMethods,
  };
}

function resolveScopes() {
  const raw = String(process.env.EKAIROS_MCP_SCOPES ?? "").trim()
  if (!raw) return ["domain.query", "domain.actions.list"]
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
}

export function GET(req) {
  const origin = (() => {
    try { return new URL(req?.url ?? "").origin } catch { return "" }
  })()
  const resourcePath = "/.well-known/domain/mcp"
  const resource = origin ? `${origin}${resourcePath}` : resourcePath
  let authorizationServer = String(process.env.EKAIROS_MCP_AUTH_SERVER ?? "").trim() || "/.well-known/oauth-authorization-server";
  if (authorizationServer && !authorizationServer.startsWith("http") && origin) {
    authorizationServer = authorizationServer.startsWith("/") ? `${origin}${authorizationServer}` : `${origin}/${authorizationServer}`
  }
  return new NextResponse(
    JSON.stringify({
      resource,
      authorization_servers: authorizationServer ? [authorizationServer] : [],
      scopes_supported: resolveScopes(),
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
