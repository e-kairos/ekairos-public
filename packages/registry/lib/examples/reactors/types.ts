import type { ContextEventForUI } from "@/components/ekairos/context/context";

export type ReactorShowcaseDefinition = {
  id: string;
  slug: string;
  title: string;
  description: string;
  reactorType: string;
  mode: "live";
  route: string;
  initialPrompt: string;
  api: {
    runPath: string;
    entitiesPath: string;
  };
};

export type ReactorShowcaseTraceSummary = {
  eventCount: number;
  chunkCount: number;
  streamTraceTotalChunks: number;
  chunkTypes: Record<string, number>;
  providerChunkTypes: Record<string, number>;
};

export type LiveReactorShowcaseTrace = {
  events: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
  summary: ReactorShowcaseTraceSummary;
};

export type LiveReactorShowcaseRunPayload = {
  appId: string;
  contextId: string;
  stream?: {
    executionId: string | null;
    source: "active" | "last" | "none";
    clientId: string | null;
    streamId: string | null;
  };
  triggerEvent: ContextEventForUI;
  assistantEvent: ContextEventForUI;
  llm: Record<string, unknown> | null;
  trace: LiveReactorShowcaseTrace;
  metadata?: {
    providerContextId: string | null;
    turnId: string | null;
    diff: string | null;
    tokenUsage: Record<string, unknown>;
    streamTrace: Record<string, unknown>;
  };
  commandExecutions?: Array<Record<string, unknown>>;
  audit?: {
    orderMatches: boolean;
    providerOrder: Array<Record<string, unknown>>;
    persistedOrder: Array<Record<string, unknown>>;
    rawProviderEvents?: Array<Record<string, unknown>>;
    rawReactorChunks?: Array<Record<string, unknown>>;
    rawPersistedParts?: Array<Record<string, unknown>>;
    comparison?: Record<string, unknown>;
  };
};

export type LiveReactorShowcaseRunResponse = {
  ok: boolean;
  data?: LiveReactorShowcaseRunPayload;
  error?: string;
};

export type ReactorShowcaseEntitiesSnapshot = {
  appId: string;
  contextId: string;
  context: Record<string, unknown> | null;
  counts: {
    executions: number;
    items: number;
    steps: number;
    parts: number;
  };
  latestExecutionAt: string | null;
  entities: {
    executions: Array<Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    steps: Array<Record<string, unknown>>;
    parts: Array<Record<string, unknown>>;
  };
};

export type ReactorShowcaseEntitiesResponse = {
  ok: boolean;
  data?: ReactorShowcaseEntitiesSnapshot;
  error?: string;
};
