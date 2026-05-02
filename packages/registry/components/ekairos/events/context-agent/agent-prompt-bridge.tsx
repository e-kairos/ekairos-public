"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** Payload queued as a virtual attachment when the user edits an inline chart. */
export type ChartEditAttachmentPayload = {
  toolCallId?: string;
  title: string;
  subtitle?: string;
  points: Array<{ label: string; value: number }>;
};

type Listener = (payload: ChartEditAttachmentPayload) => void;

export type AgentPromptBridgeValue = {
  emitChartEdit: (payload: ChartEditAttachmentPayload) => void;
  subscribe: (fn: Listener) => () => void;
};

const AgentPromptBridgeContext = createContext<AgentPromptBridgeValue | null>(
  null,
);

export function AgentPromptBridgeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const emitChartEdit = useCallback((payload: ChartEditAttachmentPayload) => {
    listeners.current.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error("AgentPromptBridge listener failed", e);
      }
    });
  }, []);

  const value = useMemo(
    () => ({ emitChartEdit, subscribe }),
    [emitChartEdit, subscribe],
  );

  return (
    <AgentPromptBridgeContext.Provider value={value}>
      {children}
    </AgentPromptBridgeContext.Provider>
  );
}

export function useAgentPromptBridge(): AgentPromptBridgeValue | null {
  return useContext(AgentPromptBridgeContext);
}
