type EventListenerLike = (event: any) => void;

function ensureEvent() {
  if (typeof globalThis.Event !== "undefined") return;
  class NodeEvent {
    type: string;
    defaultPrevented = false;
    cancelable = false;
    timeStamp = Date.now();
    constructor(type: string, init?: Record<string, unknown>) {
      this.type = type;
      if (init && typeof init === "object") {
        Object.assign(this, init);
      }
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }
  (globalThis as any).Event = NodeEvent;
}

function ensureEventTarget() {
  if (typeof globalThis.EventTarget !== "undefined") return;
  class NodeEventTarget {
    private listeners = new Map<string, Set<EventListenerLike>>();
    addEventListener(type: string, listener: EventListenerLike | null) {
      if (!listener) return;
      const bucket = this.listeners.get(type) ?? new Set<EventListenerLike>();
      bucket.add(listener);
      this.listeners.set(type, bucket);
    }
    removeEventListener(type: string, listener: EventListenerLike | null) {
      if (!listener) return;
      const bucket = this.listeners.get(type);
      if (!bucket) return;
      bucket.delete(listener);
      if (bucket.size === 0) this.listeners.delete(type);
    }
    dispatchEvent(event: any) {
      const bucket = this.listeners.get(event?.type);
      if (bucket) {
        for (const listener of [...bucket]) {
          try {
            listener.call(this, event);
          } catch {
            // ignore listener errors
          }
        }
      }
      const handler = (this as any)[`on${event?.type}`];
      if (typeof handler === "function") {
        try {
          handler.call(this, event);
        } catch {
          // ignore handler errors
        }
      }
      return !event?.defaultPrevented;
    }
  }
  (globalThis as any).EventTarget = NodeEventTarget;
}

function ensureMessageEvent() {
  if (typeof globalThis.MessageEvent !== "undefined") return;
  const BaseEvent = (globalThis as any).Event;
  class NodeMessageEvent extends BaseEvent {
    data: unknown;
    origin: string;
    lastEventId: string;
    constructor(type: string, init?: Record<string, unknown>) {
      super(type, init);
      this.data = init?.data;
      this.origin = typeof init?.origin === "string" ? init.origin : "";
      this.lastEventId = typeof init?.lastEventId === "string" ? init.lastEventId : "";
    }
  }
  (globalThis as any).MessageEvent = NodeMessageEvent;
}

export function ensureDomEvents() {
  ensureEvent();
  ensureEventTarget();
  ensureMessageEvent();
}

ensureDomEvents();
