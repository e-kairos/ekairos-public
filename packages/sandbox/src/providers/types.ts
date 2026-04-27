import type { Sandbox as VercelSandbox } from "@vercel/sandbox"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

export type SpritesSandbox = {
  __provider: "sprites"
  name: string
  id?: string
  url?: string
  getPreviewLink?: (port: number) => Promise<{ url: string }>
  domain?: (port: number) => Promise<string>
}

export type ProviderSandbox = VercelSandbox | DaytonaSandbox | SpritesSandbox

export function isVercelSandbox(
  sandbox: ProviderSandbox | unknown,
): sandbox is VercelSandbox {
  return Boolean(
    sandbox &&
      typeof sandbox === "object" &&
      typeof (sandbox as any).runCommand === "function" &&
      typeof (sandbox as any).currentSession === "function" &&
      typeof (sandbox as any).name === "string" &&
      (sandbox as any).__provider !== "sprites",
  )
}
