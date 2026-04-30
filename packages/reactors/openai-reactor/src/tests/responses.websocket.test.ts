import { describe, expect, it } from "vitest"

import {
  OpenAIResponsesWebSocket,
  parseOpenAIResponsesWebSocketMessage,
} from "../responses.websocket.js"

function serverFrame(params: { fin: boolean; opcode: number; payload: string }) {
  const payload = Buffer.from(params.payload, "utf8")
  let header: Buffer

  if (payload.length < 126) {
    header = Buffer.from([(params.fin ? 0x80 : 0) | params.opcode, payload.length])
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4)
    header[0] = (params.fin ? 0x80 : 0) | params.opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = (params.fin ? 0x80 : 0) | params.opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  return Buffer.concat([header, payload])
}

describe("parseOpenAIResponsesWebSocketMessage", () => {
  it("parses plain provider JSON frames", () => {
    expect(
      parseOpenAIResponsesWebSocketMessage(
        JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }),
      ),
    ).toEqual({
      type: "response.completed",
      response: { id: "resp_1" },
    })
  })

  it("unwraps provider frames that arrive as JSON strings", () => {
    expect(
      parseOpenAIResponsesWebSocketMessage(
        JSON.stringify(JSON.stringify({ type: "response.completed", response: { id: "resp_2" } })),
      ),
    ).toEqual({
      type: "response.completed",
      response: { id: "resp_2" },
    })
  })

  it("reassembles fragmented text frames before parsing provider events", async () => {
    const message = JSON.stringify(
      JSON.stringify({ type: "response.completed", response: { id: "resp_fragmented" } }),
    )
    const client = new OpenAIResponsesWebSocket({
      webSocketUrl: "wss://example.invalid/openai/v1/responses",
    })
    const harness = client as unknown as { handleData(chunk: Buffer): void }

    harness.handleData(
      Buffer.concat([
        serverFrame({ fin: false, opcode: 0x1, payload: message.slice(0, 12) }),
        serverFrame({ fin: false, opcode: 0x0, payload: message.slice(12, 30) }),
      ]),
    )
    harness.handleData(serverFrame({ fin: true, opcode: 0x0, payload: message.slice(30) }))

    await expect(client.read()).resolves.toEqual({
      type: "response.completed",
      response: { id: "resp_fragmented" },
    })
    client.close()
  })
})
