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

export type UseContextStateHook = (
  db: any,
  args: UseContextArgs
) => {
  context: any | null;
  contextStatus: ContextStatus;
};

export type UseContextEventsHook = (
  db: any,
  args: UseContextArgs
) => {
  events: ContextEventForUI[];
};

export type UseContextOptions = {
  apiUrl: string;
  initialContextId?: string;
  onContextUpdate?: (contextId: string) => void;
  enableResumableStreams?: boolean;

  /**
   * Optional hook overrides. These MUST be hooks (they call db.useQuery).
   *
   * If omitted, defaults are used:
   * - context(): fetches `event_contexts` by id
   * - events(): fetches `event_items` by context id (no emails/whatsapp relations)
   */
  context?: UseContextStateHook;
  events?: UseContextEventsHook;
};

