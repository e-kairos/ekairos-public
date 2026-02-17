"use client";

import { init } from "@instantdb/react";
import schema, { AppSchema } from "@/instant.schema";
import { InstantReactWebDatabase } from "@instantdb/react";

// Cache global para evitar reinicializar la DB al navegar entre rutas
const orgDbCache = new Map<string, InstantReactWebDatabase<AppSchema>>();

/**
 * Inicializa o recupera una instancia de InstantDB para un appId específico.
 */
export function getDbForApp(appId: string): InstantReactWebDatabase<AppSchema> {
  let db = orgDbCache.get(appId);
  if (!db) {
    db = init({
      appId,
      schema,
      useDateObjects: true,
    });
    orgDbCache.set(appId, db);
  }
  return db;
}













