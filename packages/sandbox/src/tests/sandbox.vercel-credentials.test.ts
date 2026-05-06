import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  resolveVercelCredentials,
  withResolvedVercelCredentials,
} from "../providers/vercel"

const ENV_KEYS = [
  "SANDBOX_VERCEL_PROJECT_ID",
  "SANDBOX_VERCEL_TEAM_ID",
  "SANDBOX_VERCEL_TOKEN",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_PROJECT_ID",
  "VERCEL_TEAM_ID",
  "VERCEL_TOKEN",
  "VERCEL_URL",
] as const

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function createLinkedProjectDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ekairos-vercel-creds-"))
  const vercelDir = path.join(dir, ".vercel")
  await mkdir(vercelDir, { recursive: true })
  await writeFile(
    path.join(vercelDir, "project.json"),
    JSON.stringify({
      orgId: "team_linked",
      projectId: "project_linked",
      projectName: "linked-project",
    }),
  )
  return dir
}

describe.sequential("Vercel credentials", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    restoreEnv()
  })

  it("delegates credential resolution to @vercel/sandbox in Vercel runtime", async () => {
    const cwd = await createLinkedProjectDir()
    try {
      process.env.VERCEL = "1"
      process.env.VERCEL_ENV = "preview"

      const creds = await resolveVercelCredentials({
        provider: "vercel",
        vercel: { cwd },
      })

      expect(creds).toEqual({})

      const params = withResolvedVercelCredentials({ name: "sandbox", resume: true }, creds)
      expect(params).toEqual({ name: "sandbox", resume: true })
      expect("teamId" in params).toBe(false)
      expect("projectId" in params).toBe(false)
      expect("token" in params).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("uses standard Vercel access-token env vars when complete", async () => {
    process.env.VERCEL_TEAM_ID = "team_env"
    process.env.VERCEL_PROJECT_ID = "project_env"
    process.env.VERCEL_TOKEN = "token_env"

    const creds = await resolveVercelCredentials({ provider: "vercel" })

    expect(creds).toEqual({
      teamId: "team_env",
      projectId: "project_env",
      token: "token_env",
    })
  })

  it("uses linked project ids with a local pulled OIDC token", async () => {
    const cwd = await createLinkedProjectDir()
    try {
      process.env.VERCEL_OIDC_TOKEN = "oidc_env"

      const creds = await resolveVercelCredentials({
        provider: "vercel",
        vercel: { cwd },
      })

      expect(creds).toEqual({
        teamId: "team_linked",
        projectId: "project_linked",
        token: "oidc_env",
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
