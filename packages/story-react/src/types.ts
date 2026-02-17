export type ContextStatus = "open" | "streaming" | "closed";
export type SendStatus = "idle" | "submitting" | "error";

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const USER_MESSAGE_TYPE = "user.message";
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

export type StoryValue = {
  apiUrl: string;

  // Context (Story semantics)
  contextId: string | null;
  contextStatus: ContextStatus;
  turnSubstateKey: string | null;

  // Timeline (Story source-of-truth)
  events: ContextEventForUI[];

  // Send lifecycle
  sendStatus: SendStatus;
  sendError: string | null;
  stop: () => void;
  append: (args: AppendArgs) => Promise<void>;
};

export type UseStoryArgs = {
  contextId: string | null;
};

export type UseStoryContextHook = (
  db: any,
  args: UseStoryArgs
) => {
  context: any | null;
  contextStatus: ContextStatus;
};

export type UseStoryEventsHook = (
  db: any,
  args: UseStoryArgs
) => {
  events: ContextEventForUI[];
};

export type UseStoryOptions = {
  apiUrl: string;
  initialContextId?: string;
  onContextUpdate?: (contextId: string) => void;
  enableResumableStreams?: boolean;

  /**
   * Optional hook overrides. These MUST be hooks (they call db.useQuery).
   *
   * If omitted, defaults are used:
   * - context(): fetches `context_contexts` by id
   * - events(): fetches `context_events` by context id (no emails/whatsapp relations)
   */
  context?: UseStoryContextHook;
  events?: UseStoryEventsHook;
};

