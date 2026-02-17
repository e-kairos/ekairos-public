import type { ThreadItem, StoredContext } from "./thread.store.js";

/**
 * Wire-safe (JSON) mirror types shared by:
 * - the workflow sender (`@ekairos/thread` steps)
 * - the ekairos-core receiver (`/api/thread`)
 *
 * Note: `StoredContext` contains Date objects, but over HTTP we send ISO strings.
 */

export type WireDate = string;

export type ThreadMirrorContext = Omit<StoredContext<unknown>, "createdAt" | "updatedAt"> & {
  createdAt: WireDate;
  updatedAt?: WireDate;
};

export type ThreadMirrorExecution = Record<string, unknown> & {
  createdAt?: WireDate;
  updatedAt?: WireDate;
};

export type ThreadMirrorWrite =
  | { type: "context.upsert"; context: ThreadMirrorContext }
  | { type: "event.upsert"; contextId: string; event: ThreadItem }
  | { type: "event.update"; eventId: string; event: ThreadItem }
  | {
      type: "execution.upsert";
      contextId: string;
      executionId: string;
      execution: ThreadMirrorExecution;
      triggerEventId: string;
      reactionEventId: string;
      setCurrentExecution?: boolean;
    };

export type ThreadMirrorRequest = {
  orgId: string;
  writes: ThreadMirrorWrite[];
};

