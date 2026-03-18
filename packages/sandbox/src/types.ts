import type { RuntimeDomainSource } from "@ekairos/domain/runtime"

export type SandboxId = string

export type SandboxDatasetConfig = {
  enabled?: boolean
}

export type SandboxSkillPackageFile = {
  path: string
  contentBase64: string
}

export type SandboxInstallableSkill = {
  name: string
  description?: string
  files: SandboxSkillPackageFile[]
}

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
  env?: Record<string, unknown>
  domain?: RuntimeDomainSource
  dataset?: SandboxDatasetConfig
  skills?: SandboxInstallableSkill[]
  /**
   * Vercel-specific options.
   */
  vercel?: {
    /**
     * Linked project name or id. Optional when cwd already contains `.vercel/project.json`.
     */
    project?: string
    /**
     * Team slug or org id. Optional when cwd already contains `.vercel/project.json`.
     */
    scope?: string
    /**
     * Working directory used to resolve `.vercel/project.json` or run `vercel env pull`.
     */
    cwd?: string
    /**
     * Environment to use for OIDC/env pull.
     */
    environment?: "development" | "preview" | "production"
    /**
     * Explicit Vercel token or OIDC token override.
     */
    token?: string
    /**
     * Explicit project id override.
     */
    projectId?: string
    /**
     * Explicit org/team id override.
     */
    orgId?: string
  }
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

