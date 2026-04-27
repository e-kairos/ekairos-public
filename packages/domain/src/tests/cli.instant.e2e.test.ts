/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"

import { createTestApp, destroyTestApp } from "@ekairos/testing/provision"

import { defineDomainAction, domain } from "../index.js"
import { configureRuntime } from "../runtime.js"
import { runCli, handleDomainCliGet, handleDomainCliPost } from "../cli/index.js"

function hasInstantProvisionToken() {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim())
}

type CliEnv = {
  actorId?: string
  actorEmail?: string | null
  refreshToken?: string
  appId?: string
}

const describeCliE2E = hasInstantProvisionToken() ? describe : describe.skip

describeCliE2E("domain cli", () => {
  let appId = ""
  let adminToken = ""
  let refreshToken = ""
  let userId = ""
  let baseUrl = ""
  let cliHome = ""
  let server: ReturnType<typeof createServer> | null = null
  let previousCliHome = ""
  let previousDomainAppId = ""

  const baseDomain = domain("cli.demo").schema({
    entities: {
      cli_tasks: i.entity({
        title: i.string().indexed(),
        createdAt: i.number().indexed(),
      }),
    },
    links: {
      cliTaskCreator: {
        forward: { on: "cli_tasks", has: "one", label: "creator" },
        reverse: { on: "$users", has: "many", label: "cliTasks" },
      },
    },
    rooms: {},
  })

  let appDomain: any
  appDomain = baseDomain.withActions({
    createTask: defineDomainAction<CliEnv, { title: string }, { taskId: string; title: string; actorId: string | null }, any, any>({
      name: "cli.task.create",
      async execute({ runtime, input, env }) {
        "use step"
        const domain = await runtime.use(appDomain)
        const taskId = newId()
        const actorId = String(env.actorId ?? "").trim() || null
        const mutations: any[] = [
          domain.db.tx.cli_tasks[taskId].update({
            title: String(input.title ?? "").trim(),
            createdAt: Date.now(),
          }),
        ]
        if (actorId) {
          mutations.push(domain.db.tx.cli_tasks[taskId].link({ creator: actorId }))
        }
        await domain.db.transact(mutations)
        return {
          taskId,
          title: String(input.title ?? "").trim(),
          actorId,
        }
      },
    }),
  })

  beforeAll(async () => {
    const app = await createTestApp({
      name: `domain-cli-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      schema: appDomain.toInstantSchema(),
      perms: {
        attrs: {
          allow: { create: "true" },
        },
        cli_tasks: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "isLoggedIn",
            update: "isLoggedIn",
            delete: "false",
          },
        },
      } as any,
    })

    appId = app.appId
    adminToken = app.adminToken
    const db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)

    userId = newId()
    refreshToken = await db.auth.createToken({ id: userId })

    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db } as any),
    })

    previousCliHome = String(process.env.EKAIROS_DOMAIN_CLI_HOME ?? "")
    previousDomainAppId = String(process.env.EKAIROS_DOMAIN_APP_ID ?? "")
    cliHome = resolve(tmpdir(), `ekairos-domain-cli-${Date.now()}`)
    process.env.EKAIROS_DOMAIN_CLI_HOME = cliHome
    process.env.EKAIROS_DOMAIN_APP_ID = appId

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }

      const request = new Request(url, {
        method: req.method,
        headers: req.headers as any,
        body:
          req.method && ["GET", "HEAD"].includes(req.method.toUpperCase())
            ? undefined
            : Buffer.concat(chunks),
      })

      const response =
        req.method === "GET"
          ? await handleDomainCliGet(request)
          : await handleDomainCliPost(request)

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      const body = Buffer.from(await response.arrayBuffer())
      res.end(body)
    })

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server")
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()))
    }
    await rm(cliHome, { recursive: true, force: true }).catch(() => {})
    if (previousCliHome) {
      process.env.EKAIROS_DOMAIN_CLI_HOME = previousCliHome
    } else {
      delete process.env.EKAIROS_DOMAIN_CLI_HOME
    }
    if (previousDomainAppId) {
      process.env.EKAIROS_DOMAIN_APP_ID = previousDomainAppId
    } else {
      delete process.env.EKAIROS_DOMAIN_APP_ID
    }
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      }).catch(() => {})
    }
  }, 5 * 60 * 1000)

  function createIo() {
    let stdout = ""
    let stderr = ""
    return {
      io: {
        stdout: {
          write(chunk: string) {
            stdout += chunk
            return true
          },
        },
        stderr: {
          write(chunk: string) {
            stderr += chunk
            return true
          },
        },
      },
      read: () => ({ stdout, stderr }),
    }
  }

  it("logs in, inspects the domain, executes JSON5 actions, and queries through client/server contexts", async () => {
    // given: a temporary Instant app, a domain CLI server, and a user refresh
    // token created during beforeAll.
    const loginIo = createIo()

    // when: the CLI logs in against the local domain route.
    const loginCode = await runCli(
      ["login", baseUrl, `--refreshToken=${refreshToken}`, `--appId=${appId}`],
      loginIo.io as any,
    )

    // then: the CLI stores the actor and app identity for later commands.
    expect(loginCode, JSON.stringify(loginIo.read())).toBe(0)
    const loginPayload = JSON.parse(loginIo.read().stdout)
    expect(loginPayload.ok).toBe(true)
    expect(loginPayload.data.baseUrl).toBe(baseUrl)
    expect(loginPayload.data.appId).toBe(appId)
    expect(loginPayload.data.actor.id).toBe(userId)

    // when: inspect reads domain metadata through the saved CLI session.
    const inspectIo = createIo()
    const inspectCode = await runCli(["inspect"], inspectIo.io as any)

    // then: the response exposes entities and registered domain actions.
    expect(inspectCode).toBe(0)
    const inspectPayload = JSON.parse(inspectIo.read().stdout)
    expect(Array.isArray(inspectPayload.data.entities)).toBe(true)
    expect(inspectPayload.data.entities).toContain("cli_tasks")
    expect(Array.isArray(inspectPayload.data.actions)).toBe(true)
    expect(
      inspectPayload.data.actions.some(
        (entry: any) => entry.key === "createTask" || entry.name === "cli.task.create",
      ),
    ).toBe(true)

    // when: an action is executed with JSON5 input.
    const actionIo = createIo()
    const actionCode = await runCli(
      ["createTask", "{ title: 'Ship CLI adapter' }"],
      actionIo.io as any,
    )

    // then: the domain action runs with actor context and returns its output.
    expect(actionCode, JSON.stringify(actionIo.read())).toBe(0)
    const actionPayload = JSON.parse(actionIo.read().stdout)
    expect(actionPayload.ok, JSON.stringify(actionPayload)).toBe(true)
    expect(actionPayload.data.action).toBe("cli.task.create")
    expect(actionPayload.data.output.title).toBe("Ship CLI adapter")
    expect(actionPayload.data.output.actorId).toBe(userId)

    // when: the query command runs without --admin.
    const clientQueryIo = createIo()
    const clientQueryCode = await runCli(
      [
        "query",
        "{ cli_tasks: { $: { order: { createdAt: 'asc' }, limit: 10 }, creator: {} } }",
        "--meta",
      ],
      clientQueryIo.io as any,
    )

    // then: the CLI uses the authenticated client path and returns linked
    // creator data.
    expect(clientQueryCode, JSON.stringify(clientQueryIo.read())).toBe(0)
    const clientQueryPayload = JSON.parse(clientQueryIo.read().stdout)
    expect(clientQueryPayload.source).toBe("client")
    expect(Array.isArray(clientQueryPayload.data.cli_tasks)).toBe(true)
    expect(clientQueryPayload.data.cli_tasks).toHaveLength(1)
    expect(clientQueryPayload.data.cli_tasks[0].title).toBe("Ship CLI adapter")
    const creator = Array.isArray(clientQueryPayload.data.cli_tasks[0].creator)
      ? clientQueryPayload.data.cli_tasks[0].creator[0]
      : clientQueryPayload.data.cli_tasks[0].creator
    expect(String(creator?.id ?? "")).toBe(userId)

    // when: the same query runs with --admin.
    const serverQueryIo = createIo()
    const serverQueryCode = await runCli(
      [
        "query",
        "{ cli_tasks: { $: { order: { createdAt: 'asc' }, limit: 10 }, creator: {} } }",
        "--admin",
        "--meta",
      ],
      serverQueryIo.io as any,
    )

    // then: the CLI uses the server/admin path and sees the same task data.
    expect(serverQueryCode, JSON.stringify(serverQueryIo.read())).toBe(0)
    const serverQueryPayload = JSON.parse(serverQueryIo.read().stdout)
    expect(serverQueryPayload.source).toBe("server")
    expect(Array.isArray(serverQueryPayload.data.cli_tasks)).toBe(true)
    expect(serverQueryPayload.data.cli_tasks[0].title).toBe("Ship CLI adapter")
  }, 5 * 60 * 1000)
})
