/* @vitest-environment node */

import { createHash } from "node:crypto"
import tls from "node:tls"
import { afterEach, describe, expect, it } from "vitest"
import { start } from "workflow/api"

import { openAIResponsesReactorWorkflowSmoke } from "./responses.reactor.workflow-fixtures.js"

const TEST_PFX_BASE64 = [
  "MIIJagIBAzCCCSYGCSqGSIb3DQEHAaCCCRcEggkTMIIJDzCCBZAGCSqGSIb3DQEHAaCCBYEEggV9",
  "MIIFeTCCBXUGCyqGSIb3DQEMCgECoIIE7jCCBOowHAYKKoZIhvcNAQwBAzAOBAhqJTdjfMFCxwIC",
  "B9AEggTI3cNttcL7bNTTZP8hNyur4XhEJmNeg3rmkE/t0QOvtCmtu9QtRjzGTY+hGqFoqD4oDPU",
  "xJ02uowxT/1FEWwHvociJqwyYcYpzcPE5RMZscaVsugBt6ic3RFh6WMUdTSmu76TSb2RVa5vYlw",
  "ilsvJ/dGUVE1o2W/aS35ZLi2++nH9OwXUHguDAJIdd5e1zmtBgXh5IFTqBKaeOYN+dhIH3kG1FV",
  "gD8BiyraksBaFP2n6lxPLsjsiwGfpl3ddK/22BxNij33duZHB5LX115mU64hr8qoHTGH4bOIA4o",
  "g5LwHsygRtZPXfDWcXB+aYOAbhFKlzQ3lwNuKrnB3g0LMdidkmwQsu4Q//atUWbHwuLYe53hY+o",
  "F5hcLuXDt8T433ccmtK4kWL5FtcCnDwIDpflttIl5PBaa2Ms1vew2thG8Ou6u8ioEUvU1lO+ZM",
  "jnXbOkm2zBHGfwqnX/GF5RXUGh/wk31rx4AJEFcz0cJA3HhrvoeMuH3SP8bUPIL7lb4Thk6Bgci",
  "NOY2xzqxNEJ6my3ZBax9LLifO/ydBrtU8oViTTvsCo6iN17xy5cD8R5u5bv2fzY20NgxK8+zdJu",
  "/syJQC+tRoLNxKjHWwhjO3PEa5eN5TN4rf0NwRoVid/dO0FMc3lMKKA9E97h/FaW+ItDqOOk+S6",
  "r/snWnur3gXhlj63FtwrZ2bYkkFqK1+/SpqkIvkhNS9+RGYRCSCbOFiAvIZOhoq5XsnVhXU2cN7",
  "oFqvrn6APtBTM3TeXjP58QXUUGZ7VW56d4oRjzInN/Ionr0hfwnZfnCGuDBtH6hmt8BPnj4r8Do",
  "J3XXYmv+4xcd6FYhi6LzrZbmhsrNW2fmgwqkY7gyS1ke/N1qgHoD5OOXYO2RCkVaGnE/x+6hAdR",
  "dlGSfkLIrAbAzul0838oapQShW5EAYwzhgWMqq6sWBoymH6m2AYqbEu+iR8nCCCwGTcpKBEoce8",
  "dx/yFcDjRUomqYx64KyqsfK08F519akZx/xd78Y+h3MO+y14Dj4lyLjC99sQihUgAjrkMvQOdRf",
  "7ntsWfSF08870F6WoyGp5CKepQWG2oagtVy5XsTi0MC50G+Ti4bd4I6keetzM3o7Dh8MolpgUoF",
  "KaKBrzn5M/IcoS5SEvZg9bCMHiTS8xb/bdIZxv5+TSqsvpC3WUJCRab3OO7O8Mpld23FVaQ+OpW",
  "rtWTy/0Ny2WuhP8RB4mYJloKS85Oo0i/RaeB2Q0XH8KAzv7CJ30Y46S0+JmKImopBlvhBBFZoAK",
  "AgA8cRk5/tMUvF5fyMF14FYuptUc9Z8GQUwXr83hSeSIOo3TRdrg2VLlZnvEYltdcmZiCXOxhRQ",
  "NcFqLsWXRhWBAmHUVE/EpLqVqsl1s03/+xdFlwJWDq6fnYaGaxi9vhwbwrTHIG7QuM0434G08PC",
  "2N52OZ9aslJjNjQha1FbOXP8v0S6Mew0wM1SacC1DL7cgseFnR4BXprCsr534EPoYtQsLhKFRwv",
  "9RJcok37LBQ6hOJbIHlQQ4DZRUOs30ELDWmn8vivpNIUUmbD5AZmaDZQ679ZJFPWyBBfDEOBUzd",
  "OSCkAC0BLS+7apdND8loTXSyk7jGPd5bZYrrM/xcDtvKL57Q0PH+1r95NFHxoL8J7IMXQwEwYJ",
  "KoZIhvcNAQkVMQYEBAEAAAAwXQYJKwYBBAGCNxEBMVAeTgBNAGkAYwByAG8AcwBvAGYAdAAgAF",
  "MAbwBmAHQAdwBhAHIAZQAgAEsAZQB5ACAAUwB0AG8AcgBhAGcAZQAgAFAAcgBvAHYAaQBkAGUA",
  "cjCCA3cGCSqGSIb3DQEHBqCCA2gwggNkAgEAMIIDXQYJKoZIhvcNAQcBMBwGCiqGSIb3DQEMAQ",
  "MwDgQIU/QZqVuLvYkCAgfQgIIDMBonr88hq9Hw/g68+L7GGccFa72r3FLr904mcSSQ34Ko51TFD",
  "YB4/rZC/yRJq0wAIjIGopwAAJDtq8596Gr2td1fWjgt6myL4+kNi/sdscehYzhvAURPT6PwHCR",
  "2WIcr4QsPMbt2MT1TA0/x90EhndlAJ1wrY6CNjJMZZmpdB/VVDOYRWTA+okU9oV5snxatohMMA",
  "C9G7oX8ar0i+OKhIwDkfM2HhrVTMZB4bbMxw7ZUGbqG0lMC3pKff/UbOBw4twRetF9+062+5vf",
  "6D/oOBHYtVMQtrluOFfqTTf3u/aWllEJbQ3JUbi09cqYMw42kFY+c6etj3n+uVhz15jDWs+aOb",
  "hAicleQeLgK4z+9L21/4wpjqQ2Mr1GFVnGU5FXCo/Dg6RIEtaUzVbqE/jHGLbzqBFIx5FrFTC",
  "H8+GhPTr+koQUaMHvaZ7xE1x7sQs856i40tWZh+2jeugQwP1A2T4V+56gjhNWKW82STtbBVfrC",
  "vQ3ZR6Xhizn26/Eb3lmSMooEjbIH/+RYXnC1/5YpvOAcj4g2OWWrhfQzs8tsDrqVtKfH7LXaRv",
  "M0SF07G3GoaUc2lP1LE6cnVXrfoJ9q8plho3f8sRbaWw50QCrArcDi51XvtrkDka9WsDwMbC5u",
  "jZOve/zTCoYMCoFqF1AcECgj3g8BdztOjkYWiXqnak+oaWIqRDlclxr5ed0XoYx/plpammN/+X",
  "gCQ71kLwhyCuRv4gzWGkMr0/ZrzRrB3aSH0tG34R3nLTkNKfMjn0Oh2paf+Rekqrt633fnDpr/",
  "lZZA9LRiQq/ENBOlGxkqcCWljzgO+z2fZlQFBw36U/Jig4Jz4j+tmTzYnhxXyLmQEX0vxh81O",
  "m3z6dRqViDZha0Qiw7xZtV2/ow6SIiAQpp26Ox4eT5IqigHWvpAn7G/STXfg9PLoKSvC4cj86",
  "WIMtBcfSO3p2FRnA6flFnuo/4UAv4FFTUATKNNadYP4n5PHsFozSoBJ3WA+HxGxbk6a5Trf9W",
  "DzZB8Z2/iilZ0oH7LO/ujjv0uZyBDyURwwQC7jSzHvx4xp4J0RAy2dxu44YUWmVwdvLKOdAcV",
  "oBHCUeCLYzA7MB8wBwYFKw4DAhoEFBqctQvQIIc2fbvenc6u9hs4ljEzBBQjRmvd5yu/ttNSs",
  "LuCBy5GjnXFvwICB9A=",
].join("")

type ServerFrame = {
  opcode: number
  payload: Buffer
  consumed: number
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function parseFrame(buffer: Buffer): ServerFrame | null {
  if (buffer.length < 2) return null
  const opcode = buffer[0]! & 0x0f
  const masked = Boolean(buffer[1]! & 0x80)
  let payloadLength = buffer[1]! & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null
    payloadLength = Number(buffer.readBigUInt64BE(offset))
    offset += 8
  }

  let mask: Buffer | null = null
  if (masked) {
    if (buffer.length < offset + 4) return null
    mask = buffer.subarray(offset, offset + 4)
    offset += 4
  }
  if (buffer.length < offset + payloadLength) return null

  let payload = buffer.subarray(offset, offset + payloadLength)
  if (mask) {
    const unmasked = Buffer.alloc(payloadLength)
    for (let index = 0; index < payloadLength; index += 1) {
      unmasked[index] = payload[index]! ^ mask[index % 4]!
    }
    payload = unmasked
  }
  return { opcode, payload, consumed: offset + payloadLength }
}

function createServerTextFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8")
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  }
  const header = Buffer.alloc(4)
  header[0] = 0x81
  header[1] = 126
  header.writeUInt16BE(payload.length, 2)
  return Buffer.concat([header, payload])
}

function responseEvents(requestIndex: number) {
  const responseId = `resp_workflow_${requestIndex}`
  const itemId = `msg_workflow_${requestIndex}`
  const text = requestIndex === 1 ? "COLD" : "HOT"
  return [
    {
      type: "response.created",
      response: { id: responseId, created_at: 1, model: "gpt-5.2" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: itemId },
    },
    {
      type: "response.output_text.delta",
      item_id: itemId,
      output_index: 0,
      delta: text,
    },
    {
      type: "response.output_text.done",
      item_id: itemId,
      output_index: 0,
      text,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: itemId },
    },
    {
      type: "response.completed",
      response: {
        id: responseId,
        model: "gpt-5.2",
        usage: { input_tokens: 8, output_tokens: 2 },
      },
    },
  ]
}

async function startMockResponsesWebSocketServer() {
  const sockets = new Set<tls.TLSSocket>()
  const requests: Record<string, unknown>[] = []
  let connectionCount = 0

  const server = tls.createServer(
    {
      pfx: Buffer.from(TEST_PFX_BASE64, "base64"),
      passphrase: "ekairos-test",
    },
    (socket) => {
      connectionCount += 1
      sockets.add(socket)
      let handshaken = false
      let handshakeBuffer = Buffer.alloc(0)
      let frameBuffer = Buffer.alloc(0)

      function writeHandshake(headerText: string) {
        const keyMatch = headerText.match(/^sec-websocket-key:\s*(.+)$/im)
        const accept = createHash("sha1")
          .update(`${keyMatch?.[1]?.trim() ?? ""}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64")
        socket.write(
          [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${accept}`,
            "",
            "",
          ].join("\r\n"),
        )
      }

      function handleFrames() {
        while (frameBuffer.length > 0) {
          const frame = parseFrame(frameBuffer)
          if (!frame) return
          frameBuffer = frameBuffer.subarray(frame.consumed)
          if (frame.opcode === 0x8) {
            socket.end()
            return
          }
          if (frame.opcode !== 0x1) continue

          const request = asRecord(JSON.parse(frame.payload.toString("utf8")))
          requests.push(request)
          for (const event of responseEvents(requests.length)) {
            socket.write(createServerTextFrame(event))
          }
        }
      }

      socket.on("data", (chunk) => {
        if (!handshaken) {
          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk])
          const headerEnd = handshakeBuffer.indexOf("\r\n\r\n")
          if (headerEnd === -1) return
          const headerText = handshakeBuffer.subarray(0, headerEnd).toString("utf8")
          frameBuffer = handshakeBuffer.subarray(headerEnd + 4)
          handshaken = true
          writeHandshake(headerText)
          handleFrames()
          return
        }
        frameBuffer = Buffer.concat([frameBuffer, chunk])
        handleFrames()
      })
      socket.on("close", () => {
        sockets.delete(socket)
      })
      socket.on("error", () => {
        sockets.delete(socket)
      })
    },
  )

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "localhost", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address !== "object") {
    throw new Error("mock_responses_wss_address_unavailable")
  }

  return {
    url: `wss://localhost:${address.port}/v1/responses`,
    get connectionCount() {
      return connectionCount
    },
    requests,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

afterEach(async () => {
  const { closeOpenAIResponsesWebSocketConnections } = await import("../responses.websocket.js")
  closeOpenAIResponsesWebSocketConnections()
})

describe("OpenAI Responses reactor + workflow/vitest", () => {
  it("runs the Responses reactor in workflow/step mode and records cold/hot metadata", async () => {
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    const server = await startMockResponsesWebSocketServer()

    try {
      const run = await start(openAIResponsesReactorWorkflowSmoke, [server.url])
      const result = await run.returnValue

      expect(String(run.runId)).toMatch(/^wrun_/)
      expect(result.workflowRunId).toBe(String(run.runId))
      expect(server.connectionCount).toBe(1)
      expect(server.requests).toHaveLength(2)
      expect(server.requests[0]?.previous_response_id).toBeUndefined()
      expect(server.requests[1]?.previous_response_id).toBe("resp_workflow_1")
      expect(result.first).toEqual(
        expect.objectContaining({
          text: "COLD",
          actionRequests: 0,
          reactorKind: "openai-responses-workflow-test",
          connectionMode: "cold",
          stateTransportMode: "cold",
          llmTransportMode: "cold",
          reusedConnection: false,
          usedPreviousResponseId: false,
          responseId: "resp_workflow_1",
        }),
      )
      expect(result.second).toEqual(
        expect.objectContaining({
          text: "HOT",
          actionRequests: 0,
          reactorKind: "openai-responses-workflow-test",
          connectionMode: "hot",
          stateTransportMode: "hot",
          llmTransportMode: "hot",
          reusedConnection: true,
          usedPreviousResponseId: true,
          responseId: "resp_workflow_2",
        }),
      )
    } finally {
      await server.close()
      if (originalRejectUnauthorized === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized
      }
    }
  })

  it("continues across a process-local transport reset using previous response state", async () => {
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    const server = await startMockResponsesWebSocketServer()

    try {
      const run = await start(openAIResponsesReactorWorkflowSmoke, [
        server.url,
        { resetTransportBetweenSteps: true },
      ])
      const result = await run.returnValue

      expect(String(run.runId)).toMatch(/^wrun_/)
      expect(result.workflowRunId).toBe(String(run.runId))
      expect(server.connectionCount).toBe(2)
      expect(server.requests).toHaveLength(2)
      expect(server.requests[0]?.previous_response_id).toBeUndefined()
      expect(server.requests[1]?.previous_response_id).toBe("resp_workflow_1")
      expect(result.first).toEqual(
        expect.objectContaining({
          text: "COLD",
          actionRequests: 0,
          reactorKind: "openai-responses-workflow-test",
          connectionMode: "cold",
          stateTransportMode: "cold",
          llmTransportMode: "cold",
          reusedConnection: false,
          usedPreviousResponseId: false,
          responseId: "resp_workflow_1",
        }),
      )
      expect(result.second).toEqual(
        expect.objectContaining({
          text: "HOT",
          actionRequests: 0,
          reactorKind: "openai-responses-workflow-test",
          connectionMode: "cold",
          stateTransportMode: "cold",
          llmTransportMode: "cold",
          reusedConnection: false,
          usedPreviousResponseId: true,
          responseId: "resp_workflow_2",
        }),
      )
    } finally {
      await server.close()
      if (originalRejectUnauthorized === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized
      }
    }
  })
})
