"use client";

import { Allow as PartialJsonAllow, parse as parsePartialJson } from "partial-json";

import type { ContextEventForUI, ContextStepRuntime } from "./react.types";
import { ASSISTANT_MESSAGE_TYPE, INPUT_TEXT_ITEM_TYPE } from "./react.types";
import {
  getActionPartInfo,
  normalizeContextEventParts,
} from "./react.context-event-parts";

type StepStreamChunk = Record<string, unknown>;

function parseContextStepStreamChunk(value: string | unknown): StepStreamChunk {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as StepStreamChunk)
      : {};
  }
  return value && typeof value === "object" ? (value as StepStreamChunk) : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstLinkedRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function linkedId(value: unknown): string {
  return asString(firstLinkedRecord(value).id);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function resolveInstantStreamsApi(db: any) {
  return db?.streams ?? db?.core?.streams ?? db?._core?.streams ?? null;
}

function decodeStreamChunkValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  return String(value ?? "");
}

function parseActionInputText(value: string): unknown {
  if (!value) return undefined;
  try {
    return parsePartialJson(
      value,
      PartialJsonAllow.OBJ |
        PartialJsonAllow.ARR |
        PartialJsonAllow.STR |
        PartialJsonAllow.NUM |
        PartialJsonAllow.BOOL |
        PartialJsonAllow.NULL,
    );
  } catch {
    return value;
  }
}

function readActionInputDelta(params: {
  chunk: Record<string, unknown>;
  data: Record<string, unknown>;
  raw: Record<string, unknown>;
  rawParams: Record<string, unknown>;
}) {
  return (
    asString(params.chunk.text) ||
    asString(params.data.text) ||
    asString(params.data.delta) ||
    asString(params.data.inputTextDelta) ||
    asString(params.raw.inputTextDelta) ||
    asString(params.raw.delta) ||
    asString(params.rawParams.delta)
  );
}

function readActionOutputDelta(params: {
  chunk: Record<string, unknown>;
  data: Record<string, unknown>;
  raw: Record<string, unknown>;
  rawParams: Record<string, unknown>;
}) {
  return (
    asString(params.chunk.text) ||
    asString(params.data.text) ||
    asString(params.data.delta) ||
    asString(params.data.outputTextDelta) ||
    asString(params.raw.outputTextDelta) ||
    asString(params.raw.delta) ||
    asString(params.rawParams.delta)
  );
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function sortEvents(events: ContextEventForUI[]) {
  const parseTs = (raw: unknown): number => {
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const ms = new Date(raw).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
  };

  return events.slice().sort((a, b) => {
    const aMs = parseTs(a.createdAt);
    const bMs = parseTs(b.createdAt);
    if (aMs !== bMs) return aMs - bMs;
    return String(a.id).localeCompare(String(b.id));
  });
}

function sanitizeStreamRecord(value: unknown): Record<string, unknown> | null {
  const record = firstLinkedRecord(value);
  const entries = Object.entries(record).filter(
    ([key]) => key !== "hashedReconnectToken",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function readStreamInfo(value: unknown) {
  const record = firstLinkedRecord(value);
  if (Object.keys(record).length === 0) return null;

  return {
    id: asString(record.id) || null,
    clientId: asString(record.clientId) || null,
    done: asBoolean(record.done),
    size: asFiniteNumber(record.size),
    machineId: asString(record.machineId) || null,
    createdAt: formatDate(record.createdAt),
    updatedAt: formatDate(record.updatedAt),
    raw: sanitizeStreamRecord(value),
  };
}

export type PersistedContextTree = {
  persistedEvents: ContextEventForUI[];
  persistedExecutions: Array<Record<string, unknown>>;
  filteredSteps: Array<Record<string, unknown>>;
  persistedPartsByStep: Map<string, Array<Record<string, unknown>>>;
  reactionEventIdByExecutionId: Map<string, string>;
};

export function extractPersistedContextTree(
  persistedContext: Record<string, unknown> | null,
): PersistedContextTree {
  const persistedExecutions = Array.isArray(persistedContext?.executions)
    ? (persistedContext.executions as Array<Record<string, unknown>>)
    : [];

  const contextItems = Array.isArray(persistedContext?.items)
    ? (persistedContext.items as ContextEventForUI[])
    : [];
  const executionItems = persistedExecutions.flatMap((execution) =>
    Array.isArray(execution.items)
      ? (execution.items as ContextEventForUI[])
      : [],
  );
  const persistedEventsById = new Map<string, ContextEventForUI>();
  for (const event of [...contextItems, ...executionItems]) {
    if (!event?.id) continue;
    persistedEventsById.set(String(event.id), event);
  }
  const persistedEvents = sortEvents([...persistedEventsById.values()]);

  const persistedSteps = persistedExecutions.flatMap((execution) => {
    const stepRows = Array.isArray(execution.steps)
      ? (execution.steps as Array<Record<string, unknown>>)
      : [];
    return stepRows.map((step) => ({
      ...step,
      execution:
        step.execution && typeof step.execution === "object"
          ? step.execution
          : { id: execution.id },
    }));
  });

  const executionIds = new Set(
    persistedExecutions.map((row) => asString(row.id)).filter(Boolean),
  );
  const filteredSteps = persistedSteps.filter((row) =>
    executionIds.has(asString(asRecord(row.execution).id)),
  );
  const filteredStepIds = new Set(
    filteredSteps.map((row) => asString((row as Record<string, unknown>).id)).filter(Boolean),
  );

  const persistedParts = filteredSteps.flatMap((step) => {
    const stepRow = step as Record<string, unknown>;
    const partRows = Array.isArray(stepRow.parts)
      ? (stepRow.parts as Array<Record<string, unknown>>)
      : [];
    return partRows.map((part) => ({
      ...part,
      step:
        part.step && typeof part.step === "object"
          ? part.step
          : { id: stepRow.id },
    }));
  });

  const filteredParts = persistedParts.filter((row) =>
    filteredStepIds.has(asString(asRecord(row.step).id)),
  );

  const persistedPartsByStep = new Map<string, Array<Record<string, unknown>>>();
  for (const row of filteredParts) {
    const stepId = asString(asRecord(row.step).id);
    if (!stepId) continue;
    const bucket = persistedPartsByStep.get(stepId) ?? [];
    bucket.push(row);
    persistedPartsByStep.set(stepId, bucket);
  }

  const reactionEventIdByExecutionId = new Map<string, string>();
  for (const execution of persistedExecutions) {
    const executionId = asString(execution.id);
    const reactionId = linkedId(execution.reaction);
    if (!executionId || !reactionId) continue;
    reactionEventIdByExecutionId.set(executionId, reactionId);
  }

  return {
    persistedEvents,
    persistedExecutions,
    filteredSteps,
    persistedPartsByStep,
    reactionEventIdByExecutionId,
  };
}

export function buildContextStepViews(params: {
  filteredSteps: Array<Record<string, unknown>>;
  persistedPartsByStep: Map<string, Array<Record<string, unknown>>>;
}): ContextStepRuntime[] {
  return params.filteredSteps
    .map((row) => {
      const stepId = asString(row.id);
      const storedPartRows = params.persistedPartsByStep.get(stepId) ?? [];
      const parts = storedPartRows
        .map((partRow) => asRecord(partRow.part))
        .filter((part) => Object.keys(part).length > 0);
      const createdAt = formatDate(row.createdAt) || new Date().toISOString();
      const status = asString(row.status) || "unknown";

      return {
        stepId,
        executionId: linkedId(row.execution) || null,
        createdAt,
        updatedAt: formatDate(row.updatedAt),
        status,
        iteration: asFiniteNumber(row.iteration),
        streamId: asString(row.streamId) || null,
        streamClientId: asString(row.streamClientId) || null,
        streamStartedAt: formatDate(row.streamStartedAt),
        streamFinishedAt: formatDate(row.streamFinishedAt),
        streamAbortReason: asString(row.streamAbortReason) || null,
        stream: readStreamInfo(row.stream),
        streamReader: null,
        parts,
      };
    })
    .sort((a, b) => {
      const aCreatedAt = new Date(a.streamStartedAt || 0).getTime();
      const bCreatedAt = new Date(b.streamStartedAt || 0).getTime();
      if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
      return String(a.stepId).localeCompare(String(b.stepId));
    });
}

export function buildLiveEventFromStepChunks(params: {
  eventId: string;
  createdAt: string;
  chunks: StepStreamChunk[];
}): ContextEventForUI {
  const textSegments: Array<{ sequence: number; text: string }> = [];
  const reasoningSegments: Array<{ sequence: number; text: string }> = [];
  const actionParts = new Map<
    string,
    {
      startedSequence?: number;
      terminalSequence?: number;
      toolName: string;
      hasStarted: boolean;
      inputDeltaText: string;
      outputDeltaText: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      terminalStatus?: "completed" | "failed";
    }
  >();
  let completed = false;
  let reasoningCompleted = false;

  for (const rawChunk of params.chunks) {
    const chunk = asRecord(rawChunk);
    const sequence = asFiniteNumber(chunk.sequence) ?? 0;
    const chunkType = asString(chunk.chunkType);

    if (chunkType === "chunk.text_delta") {
      const text =
        asString(chunk.text) ||
        asString(asRecord(chunk.data).text) ||
        asString(asRecord(chunk.data).delta) ||
        asString(asRecord(chunk.raw).delta) ||
        asString(asRecord(chunk.raw).textDelta);
      if (text) textSegments.push({ sequence, text });
    }

    if (chunkType === "chunk.reasoning_delta") {
      const text =
        asString(chunk.text) ||
        asString(asRecord(chunk.data).text) ||
        asString(asRecord(chunk.data).delta) ||
        asString(asRecord(chunk.raw).delta);
      if (text) reasoningSegments.push({ sequence, text });
    }

    if (chunkType === "chunk.reasoning_end") {
      reasoningCompleted = true;
    }

    if (
      chunkType === "chunk.action_started" ||
      chunkType === "chunk.action_input_delta" ||
      chunkType === "chunk.action_completed" ||
      chunkType === "chunk.action_failed"
    ) {
      const data = asRecord(chunk.data);
      const raw = asRecord(chunk.raw);
      const rawParams = asRecord(raw.params);
      const rawItem = asRecord(rawParams.item);
      const actionRef =
        asString(chunk.actionRef) ||
        asString(chunk.providerPartId) ||
        asString(data.actionCallId) ||
        asString(data.toolCallId) ||
        asString(data.callId) ||
        asString(data.itemId) ||
        asString(data.id) ||
        asString(rawParams.callId) ||
        asString(rawParams.itemId) ||
        asString(rawItem.id) ||
        asString(raw.toolCallId) ||
        asString(raw.id);
      if (!actionRef) continue;

      const toolName =
        asString(data.actionName) ||
        asString(data.toolName) ||
        asString(rawParams.tool) ||
        asString(rawItem.command ? "sandbox_run_command" : "") ||
        asString(raw.actionName) ||
        asString(raw.toolName) ||
        asString(raw.name) ||
        actionParts.get(actionRef)?.toolName ||
        "reactorAction";

      const previous = actionParts.get(actionRef);
      const inputDeltaText = readActionInputDelta({
        chunk,
        data,
        raw,
        rawParams,
      });
      const outputDeltaText = readActionOutputDelta({
        chunk,
        data,
        raw,
        rawParams,
      });
      const nextInputDeltaText =
        chunkType === "chunk.action_input_delta"
          ? `${previous?.inputDeltaText ?? ""}${inputDeltaText}`
          : previous?.inputDeltaText ?? "";
      const parsedInputDelta = parseActionInputText(nextInputDeltaText);
      const input =
        data.input ??
        data.arguments ??
        raw.input ??
        raw.args ??
        raw.arguments ??
        rawParams.arguments ??
        (nextInputDeltaText ? parsedInputDelta : undefined) ??
        previous?.input;
      const nextOutputDeltaText =
        chunkType === "chunk.action_completed" && outputDeltaText
          ? `${previous?.outputDeltaText ?? ""}${outputDeltaText}`
          : previous?.outputDeltaText ?? "";
      const output =
        data.output ??
        data.result ??
        rawParams.result ??
        raw.output ??
        raw.result ??
        (nextOutputDeltaText
          ? {
              text: nextOutputDeltaText,
            }
          : previous?.output);

      actionParts.set(actionRef, {
        startedSequence:
          previous?.startedSequence ??
          (chunkType === "chunk.action_started" || chunkType === "chunk.action_input_delta"
            ? sequence
            : undefined),
        terminalSequence:
          chunkType === "chunk.action_completed" ||
          chunkType === "chunk.action_failed"
            ? sequence
            : previous?.terminalSequence,
        toolName,
        hasStarted:
          previous?.hasStarted ||
          chunkType === "chunk.action_started" ||
          chunkType === "chunk.action_input_delta",
        inputDeltaText: nextInputDeltaText,
        outputDeltaText: nextOutputDeltaText,
        input:
          optionalRecord(input) ??
          (input !== undefined
            ? input
            : previous?.input),
        output:
          optionalRecord(output) ??
          (output !== undefined
            ? output
            : previous?.output),
        errorText:
          chunkType === "chunk.action_failed"
            ? asString(chunk.text) ||
              asString(data.text) ||
              asString(data.error) ||
              asString(asRecord(data.error).message) ||
              asString(rawParams.error) ||
              asString(asRecord(rawParams.error).message) ||
              asString(asRecord(raw.error).message) ||
              undefined
            : previous?.errorText,
        terminalStatus:
          chunkType === "chunk.action_failed"
            ? "failed"
            : chunkType === "chunk.action_completed"
              ? "completed"
              : previous?.terminalStatus,
      });
    }

    if (chunkType === "chunk.finish") {
      completed = true;
    }
  }

  const parts: Array<{ sequence: number; part: Record<string, unknown> }> = [];
  if (reasoningSegments.length > 0) {
    parts.push({
      sequence: reasoningSegments[reasoningSegments.length - 1]!.sequence,
      part: {
        type: "reasoning",
        content: {
          text: reasoningSegments.map((row) => row.text).join(""),
          state: completed || reasoningCompleted ? "done" : "streaming",
        },
      },
    });
  }
  if (textSegments.length > 0) {
    parts.push({
      sequence: textSegments[textSegments.length - 1]!.sequence,
      part: {
        type: "message",
        content: {
          text: textSegments.map((row) => row.text).join(""),
        },
      },
    });
  }

  for (const [toolCallId, action] of actionParts) {
    if (action.hasStarted) {
      parts.push({
        sequence: action.startedSequence ?? action.terminalSequence ?? 0,
        part: {
          type: "action",
          content: {
            status: "started",
            actionName: action.toolName,
            actionCallId: toolCallId,
            input: action.input ?? {},
          },
        },
      });
    }

    if (action.terminalStatus === "completed") {
      parts.push({
        sequence: action.terminalSequence ?? action.startedSequence ?? 0,
        part: {
          type: "action",
          content: {
            status: "completed",
            actionName: action.toolName,
            actionCallId: toolCallId,
            output: action.output ?? {},
          },
        },
      });
    }

    if (action.terminalStatus === "failed") {
      parts.push({
        sequence: action.terminalSequence ?? action.startedSequence ?? 0,
        part: {
          type: "action",
          content: {
            status: "failed",
            actionName: action.toolName,
            actionCallId: toolCallId,
            error: {
              message: action.errorText || "Action failed.",
            },
          },
        },
      });
    }
  }

  const sortedParts = parts
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.part);

  return {
    id: params.eventId,
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: params.createdAt,
    status: completed ? "completed" : "pending",
    content: { parts: sortedParts },
  };
}

export async function consumePersistedContextStepStream(params: {
  db: any;
  signal: AbortSignal;
  clientId?: string | null;
  streamId?: string | null;
  byteOffset?: number;
  onByteOffset?: (byteOffset: number) => void;
  onChunk?: (
    chunk: StepStreamChunk,
    info: {
      parsedByteOffset: number;
      streamByteOffset: number;
      rawLine: string;
    },
  ) => Promise<void> | void;
  onDone?: () => Promise<void> | void;
}) {
  const startOffset = Math.max(0, params.byteOffset ?? 0);
  const streams = resolveInstantStreamsApi(params.db);
  if (!streams?.createReadStream) {
    throw new Error(
      "InstantDB streams are not available on the provided database.",
    );
  }

  const stream = streams.createReadStream(
    params.streamId
      ? {
          streamId: params.streamId,
          byteOffset: startOffset,
        }
      : {
          clientId: params.clientId || undefined,
          byteOffset: startOffset,
        },
  );
  const reader = stream.getReader();
  const encoder = new TextEncoder();
  let nextByteOffset = startOffset;
  let parsedByteOffset = startOffset;
  let buffer = "";
  let finished = false;

  const handleAbort = () => {
    void reader.cancel().catch(() => {});
  };
  params.signal.addEventListener("abort", handleAbort, { once: true });

  try {
    while (!params.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        finished = !params.signal.aborted;
        break;
      }

      const raw = decodeStreamChunkValue(value);
      if (!raw) continue;

      nextByteOffset += encoder.encode(raw).length;
      buffer += raw;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (params.signal.aborted) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        parsedByteOffset += encoder.encode(`${line}\n`).length;
        params.onByteOffset?.(parsedByteOffset);
        await params.onChunk?.(
          parseContextStepStreamChunk(trimmed) as unknown as StepStreamChunk,
          {
            parsedByteOffset,
            streamByteOffset: nextByteOffset,
            rawLine: trimmed,
          },
        );
        if (params.signal.aborted) break;
      }
    }

    if (finished) {
      const trailing = buffer.trim();
      if (trailing) {
        parsedByteOffset += encoder.encode(buffer).length;
        params.onByteOffset?.(parsedByteOffset);
        await params.onChunk?.(
          parseContextStepStreamChunk(trailing) as unknown as StepStreamChunk,
          {
            parsedByteOffset,
            streamByteOffset: nextByteOffset,
            rawLine: trailing,
          },
        );
      }
      await params.onDone?.();
    }
  } finally {
    params.signal.removeEventListener("abort", handleAbort);
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

export function buildEventStepsIndex(params: {
  executions: Array<Record<string, unknown>>;
  steps: ContextStepRuntime[];
}): Map<string, ContextStepRuntime[]> {
  const reactionEventIdByExecutionId = new Map<string, string>();
  for (const execution of params.executions) {
    const executionId = asString(execution.id);
    const reactionId = linkedId(execution.reaction);
    if (!executionId || !reactionId) continue;
    reactionEventIdByExecutionId.set(executionId, reactionId);
  }

  const stepsByEventId = new Map<string, ContextStepRuntime[]>();
  for (const step of params.steps) {
    if (!step.executionId) continue;
    const reactionId = reactionEventIdByExecutionId.get(step.executionId);
    if (!reactionId) continue;
    const bucket = stepsByEventId.get(reactionId) ?? [];
    bucket.push(step);
    stepsByEventId.set(reactionId, bucket);
  }

  for (const [eventId, steps] of stepsByEventId) {
    stepsByEventId.set(
      eventId,
      steps.slice().sort((a, b) => {
        const aStarted = new Date(a.streamStartedAt || 0).getTime();
        const bStarted = new Date(b.streamStartedAt || 0).getTime();
        if (aStarted !== bStarted) return aStarted - bStarted;
        return String(a.stepId).localeCompare(String(b.stepId));
      }),
    );
  }

  return stepsByEventId;
}

export function isUserEvent(event: ContextEventForUI | null | undefined) {
  const type = String(event?.type ?? "");
  return type === INPUT_TEXT_ITEM_TYPE || type === "input" || type.startsWith("user.");
}
