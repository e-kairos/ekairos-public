"use client";

import {
  useThread as useThreadBase,
  type ThreadSnapshot,
  type ThreadStreamChunk,
  type UseThreadOptions as BaseUseThreadOptions,
} from "@ekairos/thread/react";

export type UseThreadOptions<
  Context = unknown,
  Item = Record<string, unknown>,
> = Omit<BaseUseThreadOptions<Context, Item>, "endpoint"> & {
  endpoint?: string;
};

export type {
  ThreadSnapshot,
  ThreadStreamChunk,
};

export function useThread<
  Context = unknown,
  Item = Record<string, unknown>,
>(options: UseThreadOptions<Context, Item>) {
  return useThreadBase<Context, Item>({
    endpoint: options.endpoint ?? "/api/thread",
    ...options,
  });
}

