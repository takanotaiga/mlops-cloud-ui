"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Surreal from "surrealdb";
import { useMutation } from "@tanstack/react-query";

interface SurrealProviderProps {
  children: React.ReactNode
  endpoint: string
  params?: Parameters<Surreal["connect"]>[1]
  client?: Surreal
  autoConnect?: boolean
  auth?: { username: string; password: string }
  ns?: string
  db?: string
}

interface SurrealProviderState {
  client: Surreal
  isConnecting: boolean
  isSuccess: boolean
  isError: boolean
  error: unknown
  connect: () => Promise<true>
  close: () => Promise<true>
}

const SurrealContext = createContext<SurrealProviderState | undefined>(undefined);

export function SurrealProvider({ children, client, endpoint, params, autoConnect = true, auth, ns, db }: SurrealProviderProps) {
  const [surrealInstance] = useState(() => client ?? new Surreal());

  const { mutateAsync: connectMutation, isPending, isSuccess, isError, error, reset } = useMutation({
    mutationFn: async () => {
      await surrealInstance.connect(endpoint, params);
      if (auth?.username && auth?.password) {
        try {
          await surrealInstance.signin({ username: auth.username, password: auth.password } as any);
        } catch (e) {
          // Some servers expect user/pass keys
          try {
            await surrealInstance.signin({ user: auth.username, pass: auth.password } as any);
          } catch (e2) {
            throw e2;
          }
        }
      }
      if (ns && db) {
        await surrealInstance.use({ namespace: ns, database: db });
      }
      return true as const;
    },
  });

  const connect = useCallback(() => connectMutation(), [connectMutation]);
  const close = useCallback(() => surrealInstance.close(), [surrealInstance]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      reset();
      surrealInstance.close();
    };
  }, [autoConnect, connect, reset, surrealInstance]);

  const value: SurrealProviderState = useMemo(
    () => ({
      client: surrealInstance,
      isConnecting: isPending,
      isSuccess,
      isError,
      error,
      connect,
      close,
    }),
    [surrealInstance, isPending, isSuccess, isError, error, connect, close],
  );

  return <SurrealContext.Provider value={value}>{children}</SurrealContext.Provider>;
}

export function useSurreal() {
  const ctx = useContext(SurrealContext);
  if (!ctx) throw new Error("useSurreal must be used within a SurrealProvider");
  return ctx;
}

export function useSurrealClient() {
  return useSurreal().client;
}
