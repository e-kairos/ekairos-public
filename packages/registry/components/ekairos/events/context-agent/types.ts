import type { ContextEventForUI } from "../context";

export type ContextHistoryItem = {
  id: string;
  title?: string;
  createdAt: string | Date | number;
};

export type AgentClassNames = {
  container?: string;
  scrollArea?: string;
  /** Merges with default padding on the scrollable message region (ConversationContent). */
  conversationContent?: string;
  /** Replaces the default spacer div between messages and prompt (default `h-4`). */
  conversationEndSpacer?: string;
  /** ConversationScrollButton positioning. */
  conversationScrollButton?: string;
  messageList?: string;
  message?: {
    container?: string;
    content?: string;
    user?: string;
    assistant?: string;
    /** Replaces default user bubble (`bg-primary` pill) when set (e.g. OLED / shell rows). */
    userContent?: string;
  };
  prompt?: string;
};

export type AgentProps = {
  apiUrl: string;
  initialContextId?: string;
  contextKey?: string;
  onContextUpdate?: (contextId: string) => void;
  prepareAppendArgs?: (args: {
    parts: any[];
    webSearch?: boolean;
    reasoningLevel?: "off" | "low" | "medium" | "high";
  }) => Promise<{
    parts: any[];
    webSearch?: boolean;
    reasoningLevel?: "off" | "low" | "medium" | "high";
  }> | {
    parts: any[];
    webSearch?: boolean;
    reasoningLevel?: "off" | "low" | "medium" | "high";
  };
  prepareRequestBody?: (params: {
    messages: any[];
    webSearch?: boolean;
    reasoningLevel?: "off" | "low" | "medium" | "high";
    contextId?: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
  enableResumableStreams?: boolean;
  streamChunkDelayMs?: number;
  onDataChunk?: (chunk: unknown) => void;
  toolComponents?: Record<string, any>;
  classNames?: AgentClassNames;
  /** Tighter prompt chrome (padding, textarea) for embedded panels. */
  promptDensity?: "default" | "compact";
  showReasoning?: boolean;
  /**
   * When set, the message list shows these events instead of the persisted context.
   * Prompt is read-only while this is a non-empty array unless `contextLayoutMockReadOnly` overrides it.
   */
  contextLayoutMockEvents?: ContextEventForUI[];
  /** When true, disables sending in the prompt for static context previews. */
  contextLayoutMockReadOnly?: boolean;
};
