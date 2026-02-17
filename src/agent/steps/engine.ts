import { engine } from "../storyEngine"

export async function evaluateToolCallsStep(params: { storyKey: string; toolCalls: Array<{ toolCallId: string; toolName: string; args: any }>; contextId: string }) {
  "use step"
  try {
    const rt = engine.get(params.storyKey)
    if (!rt?.callbacks?.evaluateToolCalls) return { success: true }
    return await rt.callbacks.evaluateToolCalls(params.toolCalls)
  } catch (error: any) {
    return { success: false, message: error?.message ?? String(error) }
  }
}

export async function onEndStep(params: { storyKey: string; lastEvent: any }) {
  "use step"
  try {
    const rt = engine.get(params.storyKey)
    if (!rt?.callbacks?.onEnd) return { end: true }
    const result = await rt.callbacks.onEnd(params.lastEvent)
    if (typeof result === "boolean") return { end: result }
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "end")) {
      return { end: Boolean((result as any).end) }
    }
    return { end: true }
  } catch {
    return { end: true }
  }
}


