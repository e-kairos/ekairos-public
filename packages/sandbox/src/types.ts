export type SandboxId = string

export type SandboxConfig = {
  /**
   * Provider selector (default: "sprites" unless SANDBOX_PROVIDER is set).
   */
  provider?: "vercel" | "daytona" | "sprites"
  /**
   * Provider runtime, e.g. "python3.13", "node22"
   */
  runtime?: string
  /**
   * Max lifetime in ms.
   */
  timeoutMs?: number
  ports?: number[]
  resources?: { vcpus?: number }
  purpose?: string
  params?: Record<string, any>
  /**
   * Daytona-specific options.
   */
  daytona?: {
    language?: "python" | "typescript" | "javascript"
    snapshot?: string
    image?: any
    envVars?: Record<string, string>
    labels?: Record<string, string>
    public?: boolean
    ephemeral?: boolean
    autoStopIntervalMin?: number
    autoArchiveIntervalMin?: number
    autoDeleteIntervalMin?: number
    user?: string
    volumes?: Array<{ volumeId?: string; volumeName?: string; mountPath: string }>
  }
  /**
   * Sprites.dev-specific options.
   */
  sprites?: {
    /**
     * Deterministic sprite name. If omitted, SandboxService will generate one.
     */
    name?: string
    /**
     * Wait for capacity when creating a new sprite.
     */
    waitForCapacity?: boolean
    /**
     * URL settings that control whether the sprite URL is public.
     * - "public": anyone can reach it (required for Codex bridge unless you add an auth proxy).
     * - "sprite": private by default.
     */
    urlSettings?: { auth?: "sprite" | "public" }
    /**
     * Whether stopSandbox should delete the sprite (provider-side).
     * If omitted, defaults to true for Sprites.
     */
    deleteOnStop?: boolean
  }
}

export type SandboxRunCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type SandboxProvider = "vercel" | "daytona" | "sprites"

