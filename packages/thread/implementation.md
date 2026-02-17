# Thread Refactor - Implementacion y Salida a Produccion

Fecha de preparacion: 2026-02-10 (02:29 AM aprox)  
Ventana objetivo: 2026-02-10 10:00 AM

## 1) Contexto operativo (decisiones cerradas)

- `ekairos-workspace` publica paquetes de libreria que consume `esolbay-platform`.
- `esolbay-platform` ya esta en produccion con tenders reales.
- Regla operativa confirmada:
  - Ejecutar release de librerias con `pnpm ship:*` en `ekairos-workspace` = salida de paquetes a npm.
  - `push` a `main` en `esolbay-platform` = deploy a produccion.
- Objetivo: migrar al nuevo modelo de `@ekairos/thread` (reactor + APIs nuevas) sin downtime.

## 2) Aclaracion de comando de release

En este repo no existe `pnpm ship` sin sufijo.  
Scripts disponibles:

- `pnpm ship:patch`
- `pnpm ship:minor`
- `pnpm ship:major`
- `pnpm ship:beta`

Para salida productiva de este feature: usar `ship:patch` o `ship:minor` (segun impacto semver acordado).

## 3) End Goal tecnico

Migrar Esolbay a Thread Refactor garantizando:

- continuidad de sesiones activas,
- compatibilidad con flujos existentes,
- cero downtime percibido por usuarios finales,
- trazabilidad completa para diagnostico/rollback.

## 4) Estrategia sin downtime

### 4.1 Principio

Deploy en dos fases desacopladas:

1. Publicar librerias (`ekairos-workspace`) manteniendo compatibilidad hacia atras.
2. Desplegar `esolbay-platform` consumiendo nuevas capacidades de forma gradual.

### 4.2 Compatibilidad requerida (bloqueante)

Antes de release:

- No romper import paths previos usados por Esolbay.
- Mantener comportamiento default del engine si no se configura reactor custom.
- Mantener estructura de persistencia compatible para lectura de historicos.

### 4.3 Activacion progresiva en Esolbay

Usar rollout por flag/logica de runtime:

- default inicial: flujo actual (estable),
- nuevo thread/reactor habilitado por:
  - org allowlist, o
  - proyecto/sesion concreta, o
  - variable de entorno de activacion.

No activar global inmediato.

## 5) Plan de salida (runbook)

## 5.1 Preflight (antes de 10:00)

En `ekairos-workspace`:

1. `pnpm install`
2. `pnpm build`
3. `pnpm test`
4. Verificar `packages/thread` compila y exporta:
   - root (`@ekairos/thread`)
   - subpaths (`/reactor`, `/codex`, `/react`, `/runtime`)
5. Confirmar que `package.json` final de `@ekairos/thread` no tenga rutas locales hardcodeadas para release publico.

En `esolbay-platform`:

1. `pnpm install`
2. Actualizar versiones objetivo de paquetes `@ekairos/*`
3. `pnpm build`
4. `pnpm test`
5. smoke funcional de session/thread sobre entorno staging/preprod.

## 5.2 Release de librerias (workspace)

Orden:

1. Checkout rama de release limpia.
2. Ejecutar release:
   - `pnpm ship:patch` (o `pnpm ship:minor` si se decide)
3. Verificar paquete publicado en npm:
   - version nueva visible,
   - `@ekairos/thread` con exports esperados.
4. Push de commit/tag generado por release.

## 5.3 Migracion de Esolbay

1. Bump de dependencias `@ekairos/*` a version publicada.
2. Integrar nuevo modelo en codigo sin remover fallback legacy.
3. Deploy a produccion (push `main`) con feature apagado por defecto.
4. Activar por canary (1 org/sesion controlada).
5. Monitorear 15-30 min:
   - errores runtime,
   - duracion de turnos,
   - tool calls,
   - persistencia de context/events/executions.
6. Si estable, ampliar rollout por etapas hasta 100%.

## 6) Pruebas minimas obligatorias (go/no-go)

### 6.1 Thread funcional

- Crear session nueva.
- Ejecutar trigger event.
- Verificar creacion de:
  - context,
  - trigger event,
  - reaction event,
  - execution,
  - steps/parts.
- Ejecutar al menos 1 tool call y validar merge de resultado.

### 6.2 Compatibilidad legacy

- Flujo existente de tender que hoy esta en prod sigue funcionando sin flag nueva.
- Lectura de conversaciones historicas no falla.

### 6.3 Reanudacion y trazas

- Reanudacion de ejecucion no pierde estado.
- Trazas se emiten y correlacionan por execution/context/run.

## 7) Rollback (sin downtime)

Si falla rollout:

1. Desactivar flag de nuevo thread/reactor en Esolbay (corte inmediato).
2. Mantener deployment activo con camino legacy.
3. Si hace falta, redeploy Esolbay al commit anterior estable.
4. No requiere rollback de npm packages si el flag corta uso.
5. Abrir incidente con:
   - timestamp,
   - org afectada,
   - executionId/contextId,
   - error signature.

## 8) Riesgos y mitigaciones

- Riesgo: diferencias de comportamiento en tooling/model loop.
  - Mitigacion: canary + fallback legacy.
- Riesgo: cambios de export/import en `@ekairos/thread`.
  - Mitigacion: build/test de Esolbay contra version exacta publicada antes de push a main.
- Riesgo: degradacion por pasos adicionales.
  - Mitigacion: monitoreo de latencia/costo por run y ajustes post-release.

## 9) Checklist final para manana 10:00

- [ ] Release package `@ekairos/thread` publicado y verificable.
- [ ] Esolbay compilado/testeado con la nueva version.
- [ ] Deploy a prod con flag off (safe start).
- [ ] Canary habilitado y validado.
- [ ] Rollout progresivo completado.
- [ ] Documento de incidentes/rollback listo.

## 10) Notas operativas (acordadas en este hilo)

- "`pnpm ship` -> salida a prod" se interpreta como release de paquetes (`ship:*`) en workspace.
- "push de esolbay a main hace release a prod tambien" queda como regla de operacion.
- Este archivo es el runbook base de ejecucion para la salida de manana.
