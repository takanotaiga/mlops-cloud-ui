"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
interface SurrealProviderProps {
  children: React.ReactNode
  autoConnect?: boolean
}

interface ApiSurrealLike {
  query: (sql: string, vars?: Record<string, unknown>) => Promise<any>;
  close: () => Promise<true>;
}

interface SurrealProviderState {
  client: ApiSurrealLike
  isConnecting: boolean
  isSuccess: boolean
  isError: boolean
  error: unknown
  connect: () => Promise<true>
  close: () => Promise<true>
}

const SurrealContext = createContext<SurrealProviderState | undefined>(undefined);

export function SurrealProvider({ children, autoConnect = true }: SurrealProviderProps) {
  const [ready, setReady] = useState(false);

  const connect = useCallback(async () => {
    // API-backed mode: no real connection needed; consider it ready
    setReady(true);
    return true as const;
  }, []);
  const close = useCallback(async () => {
    return true as const;
  }, []);

  useEffect(() => {
    if (autoConnect) void connect();
    return () => { setReady(false); };
  }, [autoConnect, connect]);

  const apiClient: ApiSurrealLike = useMemo(() => ({
    query: async (sql: string, vars?: Record<string, unknown>) => {
      const res = await fetch("/api/db/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, vars }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err?.error || `DB error ${res.status}`);
      }
      return await res.json();
    },
    close,
  }), [close]);

  const value: SurrealProviderState = useMemo(
    () => ({
      client: apiClient,
      isConnecting: !ready,
      isSuccess: ready,
      isError: false,
      error: undefined,
      connect,
      close,
    }),
    [apiClient, ready, connect, close],
  );

  return <SurrealContext.Provider value={value}>{children}</SurrealContext.Provider>;
}

export function useSurreal() {
  const ctx = useContext(SurrealContext);
  if (!ctx) throw new Error("useSurreal must be used within a SurrealProvider");
  return ctx;
}

export function useSurrealClient() { return useSurreal().client; }
