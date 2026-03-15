/* eslint-disable no-console */
"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { ContextEventForUI, ContextValue } from "../context/types";

export type ContextDebugSnapshot = {
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

class ContextDebugStore {
  private listeners = new Set<Listener>();
  private snapshots = new Map<string, ContextDebugSnapshot>();
  private cachedList: ContextDebugSnapshot[] = [];
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

  upsert(instanceId: string, context: ContextValue) {
    const next: ContextDebugSnapshot = {
      instanceId,
      apiUrl: context.apiUrl,
      contextId: context.contextId,
      contextStatus: context.contextStatus,
      sendStatus: context.sendStatus,
      turnSubstateKey: context.turnSubstateKey,
      events: Array.isArray(context.events) ? context.events : [],
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

const globalKey = "__esolbay_context_debug_store__";
const getGlobalStore = (): ContextDebugStore => {
  const g = globalThis as any;
  if (!g[globalKey]) g[globalKey] = new ContextDebugStore();
  return g[globalKey] as ContextDebugStore;
};

export function useContextDebugSnapshots(): ContextDebugSnapshot[] {
  const store = getGlobalStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useRegisterContextDebug(instanceId: string, context: ContextValue) {
  useEffect(() => {
    const store = getGlobalStore();
    store.upsert(instanceId, context);
    return () => store.remove(instanceId);
    // We intentionally re-upsert on every relevant change so the footer stays "real".
  }, [
    instanceId,
    context.apiUrl,
    context.contextId,
    context.contextStatus,
    context.sendStatus,
    context.turnSubstateKey,
    context.events,
  ]);
}

