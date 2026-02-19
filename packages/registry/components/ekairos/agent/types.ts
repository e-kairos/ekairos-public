export type AgentHistoryItem = {
  id: string;
  title?: string;
  createdAt: string | Date | number;
};

export type AgentClassNames = {
  container?: string;
  scrollArea?: string;
  messageList?: string;
  message?: {
    container?: string;
    content?: string;
    user?: string;
    assistant?: string;
  };
  prompt?: string;
};

export type AgentProps = {
  // Thread context transport
  apiUrl: string;
  initialContextId?: string;
  onContextUpdate?: (contextId: string) => void;
  enableResumableStreams?: boolean;

  // Agent UI config
  toolComponents?: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning?: boolean;
};

