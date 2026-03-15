"use client";

import { useContext, type ContextSnapshot } from "./use-context";

type UseContextDomainOptions = {
  contextKey: string;
  orgId?: string;
  refreshMs?: number;
  ensure?: boolean;
};

/**
 * Backwards-compatible alias for legacy consumers.
 * New usage should call `useContext` from `@ekairos/events/react`.
 */
export function useContextDomain(options: UseContextDomainOptions) {
  const { data, isLoading, error, refresh } = useContext(options);
  return {
    data: data as ContextSnapshot | null,
    isLoading,
    error,
    refresh,
  };
}
