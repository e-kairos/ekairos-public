import type { SandboxConfig, SandboxProvider } from "../types.js"

export function resolveProvider(config: SandboxConfig): SandboxProvider {
  const explicit = String(config.provider ?? "").trim().toLowerCase()
  if (explicit === "daytona") return "daytona"
  if (explicit === "vercel") return "vercel"
  if (explicit === "sprites") return "sprites"

  const env = String(process.env.SANDBOX_PROVIDER ?? "").trim().toLowerCase()
  if (env === "daytona") return "daytona"
  if (env === "vercel") return "vercel"
  if (env === "sprites") return "sprites"

  return "sprites"
}
