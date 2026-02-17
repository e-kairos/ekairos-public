import type { UIMessageChunk } from "ai";

export async function writeContextSubstate(params: {
  /**
   * Ephemeral substate key for the UI (thread engine internal state).
   *
   * - Provide a string key like "actions" to set it
   * - Provide null to clear it
   */
  key: string | null;
  transient?: boolean;
  writable?: WritableStream<UIMessageChunk>;
}) {
  "use step"
  const writable = params.writable;
  if (!writable) return;
  const writer = writable.getWriter();
  try {
    await writer.write({
      type: "data-context-substate",
      data: { key: params.key },
      transient: params.transient ?? true,
    } as any);
  } finally {
    writer.releaseLock();
  }
}

export async function writeContextIdChunk(params: {
  contextId: string;
  writable?: WritableStream<UIMessageChunk>;
}) {
  "use step"
  const writable = params.writable;
  if (!writable) return;
  const writer = writable.getWriter();
  try {
    await writer.write({
      type: "data-context-id",
      id: params.contextId,
      data: { contextId: params.contextId },
    } as any);
  } finally {
    writer.releaseLock();
  }
}

export async function writeThreadPing(params: {
  /**
   * Simple ping event to validate that the workflow stream is alive.
   * This is intentionally generic so clients can ignore it safely.
   */
  label?: string;
  writable?: WritableStream<UIMessageChunk>;
}) {
  "use step"
  const writable = params.writable;
  if (!writable) return;
  const writer = writable.getWriter();
  try {
    await writer.write({
      type: "data-thread-ping",
      data: { label: params.label ?? "thread-ping" },
      transient: true,
    } as any);
  } finally {
    writer.releaseLock();
  }
}

export async function writeToolOutputs(params: {
  results: Array<
    | { toolCallId: string; success: true; output: unknown }
    | { toolCallId: string; success: false; errorText: string }
  >;
  writable?: WritableStream<UIMessageChunk>;
}) {
  "use step"
  const writable = params.writable;
  if (!writable) return;
  const writer = writable.getWriter();
  try {
    for (const r of params.results) {
      if (r.success) {
        await writer.write({
          type: "tool-output-available",
          toolCallId: r.toolCallId,
          output: r.output as any,
        } as any);
      } else {
        await writer.write({
          type: "tool-output-error",
          toolCallId: r.toolCallId,
          errorText: r.errorText,
        } as any);
      }
    }
  } finally {
    writer.releaseLock();
  }
}

export async function closeThreadStream(params: {
  preventClose?: boolean;
  sendFinish?: boolean;
  writable?: WritableStream<UIMessageChunk>;
}) {
  "use step"
  const sendFinish = params.sendFinish ?? true;
  const preventClose = params.preventClose ?? false;
  const writable = params.writable;
  if (!writable) return;

  if (sendFinish) {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "finish" } as any);
    } finally {
      writer.releaseLock();
    }
  }

  if (!preventClose) {
    await writable.close();
  }
}

