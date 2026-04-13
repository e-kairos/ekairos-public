import { describe, expect, it } from "vitest"

import {
  resolveVercelSandboxConfig,
  safeVercelConfigForRecord,
} from "../vercel-options"

describe("Vercel sandbox options", () => {
  it("uses cost-conscious defaults for ephemeral Vercel sandboxes", () => {
    const resolved = resolveVercelSandboxConfig(
      {
        provider: "vercel",
      },
      { sandboxId: "sandbox-ephemeral", env: {} },
    )

    expect(resolved.profile).toBe("ephemeral")
    expect(resolved.runtime).toBe("node22")
    expect(resolved.timeoutMs).toBe(5 * 60 * 1000)
    expect(resolved.vcpus).toBe(1)
    expect(resolved.persistent).toBe(false)
    expect(resolved.reuse).toBe(false)
    expect(resolved.deleteOnStop).toBe(true)
    expect(resolved.tags).toMatchObject({
      ekairos: "1",
      profile: "ephemeral",
      sandboxId: "sandbox-ephemeral",
    })
  })

  it("uses persistent reusable defaults for coding-agent sandboxes", () => {
    const resolved = resolveVercelSandboxConfig(
      {
        provider: "vercel",
        purpose: "codex-reactor",
        ports: [3000, 3000, 8080],
        vercel: {
          name: "ekairos codex workspace",
        },
      },
      { sandboxId: "sandbox-agent", env: {} },
    )

    expect(resolved.profile).toBe("coding-agent")
    expect(resolved.timeoutMs).toBe(20 * 60 * 1000)
    expect(resolved.vcpus).toBe(2)
    expect(resolved.persistent).toBe(true)
    expect(resolved.reuse).toBe(true)
    expect(resolved.deleteOnStop).toBe(false)
    expect(resolved.name).toBe("ekairos-codex-workspace")
    expect(resolved.ports).toEqual([3000, 8080])
    expect(resolved.snapshotExpirationMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("honors explicit overrides and never persists Vercel tokens in records", () => {
    const config = {
      provider: "vercel" as const,
      runtime: "node24",
      timeoutMs: 42 * 60 * 1000,
      resources: { vcpus: 4 },
      vercel: {
        token: "secret-token",
        profile: "ephemeral" as const,
        name: "custom-name",
        reuse: true,
        persistent: true,
        deleteOnStop: true,
        snapshotExpirationMs: 0,
        tags: {
          custom: "value",
          extra: "ignored-when-over-limit",
        },
      },
    }

    const resolved = resolveVercelSandboxConfig(config, {
      sandboxId: "sandbox-custom",
      env: {
        SANDBOX_VERCEL_TIMEOUT_MS: String(5 * 60 * 1000),
        SANDBOX_VERCEL_VCPUS: "1",
      },
    })
    const record = safeVercelConfigForRecord(config, resolved)

    expect(resolved.runtime).toBe("node24")
    expect(resolved.timeoutMs).toBe(42 * 60 * 1000)
    expect(resolved.vcpus).toBe(4)
    expect(resolved.persistent).toBe(true)
    expect(resolved.reuse).toBe(true)
    expect(resolved.deleteOnStop).toBe(true)
    expect(resolved.snapshotExpirationMs).toBe(0)
    expect(JSON.stringify(record)).not.toContain("secret-token")
    expect(record.token).toBeUndefined()
  })
})
