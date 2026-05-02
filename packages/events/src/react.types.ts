export type ContextStatus = "open_idle" | "open_streaming" | "closed";
export type SendStatus = "idle" | "submitting" | "error";

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const INPUT_TEXT_ITEM_TYPE = "user.message";
export const ASSISTANT_MESSAGE_TYPE = "assistant.message";

export type ContextEventForUI = {
  id: string;
  type: string;
  channel: string;
  createdAt: string | Date;
  content: { parts: any[] };
  status?: string;
  emails?: unknown[];
  whatsappMessages?: unknown[];
  executionId?: string | null;
  steps?: ContextStepForUI[];
};

export type ContextStepForUI = {
  stepId: string;
  executionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  status: string;
  iteration: number | null;
  parts: Array<Record<string, unknown>>;
};

export type ContextStepRuntime = ContextStepForUI & {
  streamId: string | null;
  streamClientId: string | null;
  streamStartedAt: string | null;
  streamFinishedAt: string | null;
  streamAbortReason: string | null;
  stream: ContextStepStreamInfo | null;
  streamReader: ContextStepStreamReaderInfo | null;
};

export type ContextStepStreamInfo = {
  id: string | null;
  clientId: string | null;
  done: boolean | null;
  size: number | null;
  machineId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown> | null;
};

export type ContextStepStreamReaderInfo = {
  status: string;
  streamKey: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  attempts: number;
  chunkCount: number;
  byteOffset: number;
  streamByteOffset: number;
  lastChunkType: string | null;
  lastSequence: number | null;
  lastError: string | null;
  reason: string | null;
  rawChunkSampleOffset: number;
  rawChunkSample: Array<Record<string, unknown>>;
  rawLineSample: string[];
};

export type AppendArgs = {
  parts: any[];
  webSearch?: boolean;
  reasoningLevel?: ReasoningLevel;
};

export type ContextFirstLevel = {
  id: string;
  key?: string | null;
  name?: string | null;
  status: ContextStatus;
  content?: unknown;
  currentExecution?: {
    id: string;
    status?: string | null;
  } | null;
};

export type ContextValue = {
  apiUrl: string;
  context: ContextFirstLevel | null;
  contextId: string | null;
  contextStatus: ContextStatus;
  activeExecutionId: string | null;
  turnSubstateKey: string | null;
  events: ContextEventForUI[];
  sendStatus: SendStatus;
  sendError: string | null;
  stop: () => void;
  append: (args: AppendArgs) => Promise<void>;
};

export type UseContextArgs = {
  contextId: string | null;
  contextKey?: string;
};

export type UseContextState = {
  context: any | null;
  contextStatus: ContextStatus;
  events: ContextEventForUI[];
};

export type UseContextStateHook = (
  db: any,
  args: UseContextArgs
) => UseContextState;

export type UseContextOptions = {
  apiUrl: string;
  initialContextId?: string;
  contextKey?: string;
  onContextUpdate?: (contextId: string) => void;
  prepareAppendArgs?: (args: AppendArgs) => Promise<AppendArgs> | AppendArgs;
  prepareRequestBody?: (params: {
    messages: any[];
    webSearch?: boolean;
    reasoningLevel?: ReasoningLevel;
    contextId?: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
  enableResumableStreams?: boolean;
  streamChunkDelayMs?: number;
  onDataChunk?: (chunk: unknown) => void;
  state?: UseContextStateHook;
};
