/* eslint-disable no-console */
"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { ContextEventForUI, ThreadValue } from "../context/types";

export type ThreadDebugSnapshot = {
  instanceId: string;
  apiUrl: string;
  contextId: string | null;
  contextStatus: string;
  sendStatus: string;
  turnSubstateKey: string | null;
  events: ContextEventForUI[];
  updatedAtMs: number;
};

type Listener = () => void;

class ThreadDebugStore {
  private listeners = new Set<Listener>();
  private snapshots = new Map<string, ThreadDebugSnapshot>();
  private cachedList: ThreadDebugSnapshot[] = [];
  private dirty = true;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => {
    // IMPORTANT:
    // `useSyncExternalStore` requires `getSnapshot()` to be referentially stable
    // (return the same object) when nothing changed. Otherwise React can warn
    // about an infinite loop ("The result of getSnapshot should be cached").
    if (!this.dirty) return this.cachedList;

    this.cachedList = Array.from(this.snapshots.values()).sort((a, b) => {
      // Most recently updated first
      return b.updatedAtMs - a.updatedAtMs;
    });
    this.dirty = false;
    return this.cachedList;
  };

  upsert(instanceId: string, thread: ThreadValue) {
    const next: ThreadDebugSnapshot = {
      instanceId,
      apiUrl: thread.apiUrl,
      contextId: thread.contextId,
      contextStatus: thread.contextStatus,
      sendStatus: thread.sendStatus,
      turnSubstateKey: thread.turnSubstateKey,
      events: Array.isArray(thread.events) ? thread.events : [],
      updatedAtMs: Date.now(),
    };
    this.snapshots.set(instanceId, next);
    this.dirty = true;
    this.emit();
  }

  remove(instanceId: string) {
    const existed = this.snapshots.delete(instanceId);
    if (existed) this.dirty = true;
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

const globalKey = "__esolbay_thread_debug_store__";
const getGlobalStore = (): ThreadDebugStore => {
  const g = globalThis as any;
  if (!g[globalKey]) g[globalKey] = new ThreadDebugStore();
  return g[globalKey] as ThreadDebugStore;
};

export function useThreadDebugSnapshots(): ThreadDebugSnapshot[] {
  const store = getGlobalStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useRegisterThreadDebug(instanceId: string, thread: ThreadValue) {
  useEffect(() => {
    const store = getGlobalStore();
    store.upsert(instanceId, thread);
    return () => store.remove(instanceId);
    // We intentionally re-upsert on every relevant change so the footer stays "real".
  }, [
    instanceId,
    thread.apiUrl,
    thread.contextId,
    thread.contextStatus,
    thread.sendStatus,
    thread.turnSubstateKey,
    thread.events,
  ]);
}

