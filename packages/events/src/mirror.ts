import type { ContextItem, StoredContext } from "./context.store.js";

/**
 * Wire-safe (JSON) mirror types shared by:
 * - the workflow sender (`@ekairos/events` steps)
 * - the ekairos-core receiver (`/api/context`)
 *
 * Note: `StoredContext` contains Date objects, but over HTTP we send ISO strings.
 */

export type WireDate = string;

export type ContextMirrorContext = Omit<StoredContext<unknown>, "createdAt" | "updatedAt"> & {
  createdAt: WireDate;
  updatedAt?: WireDate;
};

export type ContextMirrorExecution = Record<string, unknown> & {
  createdAt?: WireDate;
  updatedAt?: WireDate;
};

export type ContextMirrorWrite =
  | { type: "context.upsert"; context: ContextMirrorContext }
  | { type: "event.upsert"; contextId: string; event: ContextItem }
  | { type: "event.update"; eventId: string; event: ContextItem }
  | {
      type: "execution.upsert";
      contextId: string;
      executionId: string;
      execution: ContextMirrorExecution;
      triggerEventId: string;
      reactionEventId: string;
      setCurrentExecution?: boolean;
    };

export type ContextMirrorRequest = {
  orgId: string;
  writes: ContextMirrorWrite[];
};

