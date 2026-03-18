export type ContextStatus = "open" | "streaming" | "closed";
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
};

export type AppendArgs = {
  parts: any[];
  webSearch?: boolean;
  reasoningLevel?: ReasoningLevel;
};

export type ContextValue = {
  apiUrl: string;

  // Context state
  contextId: string | null;
  contextStatus: ContextStatus;
  turnSubstateKey: string | null;

  // Timeline source of truth
  events: ContextEventForUI[];

  // Send lifecycle
  sendStatus: SendStatus;
  sendError: string | null;
  stop: () => void;
  append: (args: AppendArgs) => Promise<void>;
};

export type UseContextArgs = {
  contextId: string | null;
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
  onContextUpdate?: (contextId: string) => void;
  enableResumableStreams?: boolean;

  /**
   * Optional hook overrides. These MUST be hooks (they call db.useQuery).
   *
   * If omitted, the default implementation fetches the context and its items in one tree query.
   */
  state?: UseContextStateHook;
};

