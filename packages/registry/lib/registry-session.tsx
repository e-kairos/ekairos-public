"use client";

import * as React from "react";

import { getDbForApp } from "@/lib/client-org-db";
import { OrgDbProvider } from "@/lib/org-db-context";

export type RegistrySession = {
  visitorId: string;
  appId: string;
  adminToken: string;
  title: string;
  created: boolean;
  recovered: boolean;
};

type RegistrySessionStatus = "initializing" | "ready" | "error";

type InitTenantResponse = {
  ok: boolean;
  data?: RegistrySession;
  error?: string;
};

type RegistrySessionContextValue = {
  session: RegistrySession | null;
  status: RegistrySessionStatus;
  error: string | null;
  ensureSession: () => Promise<RegistrySession>;
  recreateSession: () => Promise<RegistrySession>;
  destroySession: () => Promise<void>;
  fetchWithSession: <T>(execute: (session: RegistrySession) => Promise<T>) => Promise<T>;
};

const VISITOR_STORAGE_KEY = "ekairos.registry.examples.visitorId";
const APP_STORAGE_KEY = "ekairos.registry.examples.appId";
const APP_ADMIN_TOKEN_STORAGE_KEY = "ekairos.registry.examples.adminToken";
const APP_TITLE_STORAGE_KEY = "ekairos.registry.examples.title";

const RegistrySessionContext = React.createContext<RegistrySessionContextValue | null>(null);

function createVisitorId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecoverableSessionError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("app not found") ||
    normalized.includes("app disappeared") ||
    normalized.includes("credentials") ||
    normalized.includes("admin token") ||
    normalized.includes("not initialized") ||
    normalized.includes("tenant") ||
    normalized.includes("cache")
  );
}

function readStoredSession(): RegistrySession | null {
  if (typeof window === "undefined") return null;
  const visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY)?.trim() || "";
  const appId = window.localStorage.getItem(APP_STORAGE_KEY)?.trim() || "";
  const adminToken = window.localStorage.getItem(APP_ADMIN_TOKEN_STORAGE_KEY)?.trim() || "";
  const title = window.localStorage.getItem(APP_TITLE_STORAGE_KEY)?.trim() || "";
  if (!visitorId || !appId || !adminToken) return null;
  return {
    visitorId,
    appId,
    adminToken,
    title,
    created: false,
    recovered: true,
  };
}

function writeStoredSession(session: RegistrySession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VISITOR_STORAGE_KEY, session.visitorId);
  window.localStorage.setItem(APP_STORAGE_KEY, session.appId);
  window.localStorage.setItem(APP_ADMIN_TOKEN_STORAGE_KEY, session.adminToken);
  window.localStorage.setItem(APP_TITLE_STORAGE_KEY, session.title);
}

function clearStoredSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(APP_STORAGE_KEY);
  window.localStorage.removeItem(APP_ADMIN_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(APP_TITLE_STORAGE_KEY);
}

async function requestSession(preferredAppId?: string | null): Promise<RegistrySession> {
  if (typeof window === "undefined") {
    throw new Error("Registry session initialization requires browser context.");
  }

  let visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY)?.trim() || "";
  if (!visitorId) {
    visitorId = createVisitorId();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
  }

  const response = await fetch("/api/examples/tenant/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      visitorId,
      appId: preferredAppId ?? null,
    }),
  });

  const payload = (await response.json()) as InitTenantResponse;
  if (!response.ok || !payload.ok || !payload.data?.appId || !payload.data?.adminToken) {
    throw new Error(payload.error || "Failed to initialize registry tenant.");
  }

  writeStoredSession(payload.data);
  return payload.data;
}

export function RegistrySessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] = React.useState<RegistrySession | null>(null);
  const [status, setStatus] = React.useState<RegistrySessionStatus>("initializing");
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef<Promise<RegistrySession> | null>(null);

  const ensureSession = React.useCallback(async () => {
    if (session) return session;
    if (inFlightRef.current) return await inFlightRef.current;

    const stored = readStoredSession();
    if (stored) {
      setSession(stored);
    }

    setStatus("initializing");
    setError(null);
    const promise = requestSession(stored?.appId ?? null)
      .then((next) => {
        setSession(next);
        setStatus("ready");
        setError(null);
        return next;
      })
      .catch((nextError) => {
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        setSession(null);
        setStatus("error");
        setError(message);
        throw nextError;
      })
      .finally(() => {
        inFlightRef.current = null;
      });

    inFlightRef.current = promise;
    return await promise;
  }, [session]);

  const recreateSession = React.useCallback(async () => {
    clearStoredSession();
    setSession(null);
    setStatus("initializing");
    setError(null);
    const next = await requestSession(null);
    setSession(next);
    setStatus("ready");
    setError(null);
    return next;
  }, []);

  const destroySession = React.useCallback(async () => {
    const current = session ?? readStoredSession();
    clearStoredSession();
    setSession(null);
    setStatus("initializing");
    setError(null);
    if (!current?.appId) return;
    await fetch("/api/examples/tenant/destroy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: current.appId }),
    }).catch(() => null);
  }, [session]);

  const fetchWithSession = React.useCallback(
    async <T,>(execute: (nextSession: RegistrySession) => Promise<T>): Promise<T> => {
      const current = await ensureSession();
      try {
        return await execute(current);
      } catch (currentError) {
        if (!isRecoverableSessionError(currentError)) {
          throw currentError;
        }
        const next = await recreateSession();
        return await execute(next);
      }
    },
    [ensureSession, recreateSession],
  );

  React.useEffect(() => {
    void ensureSession();
  }, [ensureSession]);

  const db = React.useMemo(
    () => (session?.appId ? getDbForApp(session.appId) : null),
    [session?.appId],
  );

  const value = React.useMemo<RegistrySessionContextValue>(
    () => ({
      session,
      status,
      error,
      ensureSession,
      recreateSession,
      destroySession,
      fetchWithSession,
    }),
    [destroySession, ensureSession, error, fetchWithSession, recreateSession, session, status],
  );

  return (
    <RegistrySessionContext.Provider value={value}>
      <OrgDbProvider db={db}>{children}</OrgDbProvider>
    </RegistrySessionContext.Provider>
  );
}

export function useRegistrySession(): RegistrySessionContextValue {
  const context = React.useContext(RegistrySessionContext);
  if (!context) {
    throw new Error("useRegistrySession must be used within RegistrySessionProvider");
  }
  return context;
}
