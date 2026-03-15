"use client";

import {
  useContext as useContextBase,
  type ContextSnapshot,
  type ContextStreamChunk,
  type UseContextOptions as BaseUseContextOptions,
} from "@ekairos/events/react";

export type UseContextOptions<
  Context = unknown,
  Item = Record<string, unknown>,
> = Omit<BaseUseContextOptions<Context, Item>, "endpoint"> & {
  endpoint?: string;
};

export type {
  ContextSnapshot,
  ContextStreamChunk,
};

export function useContext<
  Context = unknown,
  Item = Record<string, unknown>,
>(options: UseContextOptions<Context, Item>) {
  return useContextBase<Context, Item>({
    endpoint: options.endpoint ?? "/api/context",
    ...options,
  });
}

