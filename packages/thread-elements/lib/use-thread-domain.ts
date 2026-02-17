"use client";

import { useThread, type ThreadSnapshot } from "./use-thread";

type UseThreadDomainOptions = {
  threadKey: string;
  orgId?: string;
  refreshMs?: number;
  ensure?: boolean;
};

/**
 * Backwards-compatible alias for legacy consumers.
 * New usage should call `useThread` from `@ekairos/thread/react`.
 */
export function useThreadDomain(options: UseThreadDomainOptions) {
  const { data, isLoading, error, refresh } = useThread(options);
  return {
    data: data as ThreadSnapshot | null,
    isLoading,
    error,
    refresh,
  };
}
