# AGENTS.md — Guía del módulo `@ekairos/structure`

Este documento está **enfocado en el módulo `packages/structure`**: su layout, responsabilidades, interfaces públicas, invariantes de runtime (`"use workflow"` / `"use step"`), y cómo desarrollarlo/probarlo usando el harness `workflow-smoke`.

> Restricción operativa: **no edites prompts** (`src/prompts.ts`) salvo pedido explícito; son funcionalidad.

---

## 0) Idea central: `structure` y su interacción con el resto del sistema

Para evitar confusiones:

- **`@ekairos/structure` (este módulo)**: define el flujo de **extracción estructurada** (rows u object). Es quien decide *qué* hacer y *en qué orden*.
- **`@ekairos/story`**: provee el “motor” de orquestación durable (estado persistido + replay). `structure` implementa una Story `"ekairos.structure"` y escribe su estado en `event_contexts` bajo la clave `structure:<datasetId>`.
- **`@ekairos/sandbox`**: provee el runtime aislado para side-effects (archivos/commands). `structure` prepara un “workstation” por dataset y opera archivos via steps.
- **InstantDB**: es el backend persistente:
  - `event_contexts`: source-of-truth del estado de la Story (incluyendo `content.structure.*`).
  - `storage`: para outputs de rows (p.ej. `output.jsonl`) y lectura de `$files`.
- **Framework `workflow`**: cuando ejecutamos `structure` dentro de un workflow durable, se vuelve crítico respetar la frontera:
  - `"use workflow"`: orquesta y debe ser determinista, con runtime limitado.
  - `"use step"`: hace el trabajo con runtime completo (Node), con retries y observabilidad.

En este repo, `packages/structure/workflow-smoke` es el harness que ejecuta un workflow real y deja trazas locales en:
- `packages/structure/workflow-smoke/.next/workflow-data`

---

## 1) Qué es `@ekairos/structure` (responsabilidad del módulo)

`@ekairos/structure` implementa un flujo de **extracción estructurada** (rows u object) desde inputs heterogéneos:
- **text** (string + mimeType)
- **file** (Instant `$files`)
- **dataset** (salida previa en JSONL)

Internamente coordina:
- **Story** para orquestación durable (contexto persistido y replayable).
- **Sandbox** para side-effects (archivos/commands) en runtime aislado.
- **InstantDB** para persistencia de contexto (`event_contexts`) y storage de outputs (p.ej. `output.jsonl`).

---

## 2) API pública (lo que se exporta)

El entrypoint del paquete exporta:
- `src/structure.ts` (builder `structure()`)
- `src/schema.ts` (domain/schema Instant)
- `src/service.ts` (helpers para leer outputs fuera del workflow runtime)
- `src/datasetFiles.ts` (paths convencionales en el sandbox)

Referencia:
- `packages/structure/src/index.ts`

---

## 3) Layout del módulo (carpetas/archivos y responsabilidades)

### `src/structure.ts` — Builder + Story (orquestación principal)

Define el builder `structure(env, opts?)` que arma configuración y ejecuta el flujo.

Responsabilidades:
- Mantener un `datasetId` (genera UUID workflow-safe si no se pasa).
- Construir una Story `"ekairos.structure"` con:
  - **context**: prepara sandbox, normaliza contexto persistido y arma `promptContext`.
  - **narrative**: compone prompt final (sin editar prompts, solo los usa).
  - **actions**: expone herramientas (tools) en función del modo (`auto` vs `schema`) y output (`rows` vs `object`).
- Ejecutar el loop hasta que el modelo ejecute `complete`.

Datos clave persistidos:
- Context key: `structure:<datasetId>` (en `event_contexts`).
- Payload principal en `context.content.structure.*` (namespacing para no pisar runtime state del Story engine).

### `src/schema.ts` — Domain y links (InstantDB)

Responsabilidades:
- Definir entidades mínimas requeridas para compatibilidad con archivos (`$files`).
- Definir el link `event_contexts.structure_output_file -> $files` para salida `rows` (JSONL).

Referencia:
- `packages/structure/src/schema.ts`

### `src/dataset/steps.ts` — Steps para contexto + storage de outputs (rows)

Son `"use step"` y **tocan runtime extendido**:
- get/create context
- update/patch content
- upload `output.jsonl` a Instant storage
- link/unlink del file a la entidad `event_contexts`
- read back del JSONL (descarga + base64)

Punto clave:
- Cualquier uso de `Buffer` está aquí (step runtime), no en `"use workflow"`.

Referencia:
- `packages/structure/src/dataset/steps.ts`

### `src/sandbox/steps.ts` — Steps para sandbox (IO/commands/files)

Son `"use step"` y encapsulan side effects:
- crear sandbox
- correr commands (ej: `mkdir -p ...`)
- escribir/leer archivos (base64)
- helpers workflow-safe para texto:
  - `writeDatasetSandboxTextFileStep`
  - `readDatasetSandboxTextFileStep`

Referencia:
- `packages/structure/src/sandbox/steps.ts`

### `src/file/steps.ts` — Step para leer `$files` (Instant storage)

Responsabilidad:
- Dado `fileId`, resolver URL y retornar `contentBase64` + metadata relevante.

Referencia:
- `packages/structure/src/file/steps.ts`

### `src/*.tool.ts` y `src/steps/*.step.ts` — Tools/Steps de alto nivel

Estos archivos implementan acciones que el modelo invoca durante la Story:
- `executeCommand.tool.ts`, `clearDataset.tool.ts`, `generateSchema.tool.ts`, `completeRows.tool.ts`, `completeObject.tool.ts`
- steps auxiliares para persistencia/commit:
  - `steps/persistObjectFromStory.step.ts`
  - `steps/commitFromEvents.step.ts`

> Nota: **no documentamos prompts en detalle** (solo su rol) para evitar editarlos accidentalmente.

### `src/service.ts` — Lectura “fuera del workflow runtime” (back-compat)

`DatasetService` existe para integraciones donde quieres leer outputs sin ejecutar el flujo.

Responsabilidades:
- `getDatasetById()` leyendo `event_contexts` por key `structure:<id>`
- `readRecordsFromFile()` leyendo el archivo JSONL linkeado (rows)
- helpers de storage/linking (cuando se usa fuera de Story runtime)

Referencia:
- `packages/structure/src/service.ts`

### `src/tests/*` — Tests unitarios/integración del módulo

Validan:
- modo `auto` vs `schema`
- output `rows` vs `object`
- combinaciones (dataset→object, joins, CSV complejos)
- trazabilidad/toolcalls

---

## 4) Contrato de runtime: `"use workflow"` vs `"use step"` (aplicado a Structure)

Fuente recomendada: `https://useworkflow.dev/docs/foundations/workflows-and-steps`

### `"use workflow"` (replayable / restringido)

Qué significa:
- Un workflow (durable function) es lógica de larga duración que **persiste su progreso** y puede **suspender/reanudar** sin perder estado.
- El workflow function se parece más a “coser” steps con `if/for/try/catch/Promise.all` que a un runtime Node completo.

Características clave (según la doc):
- Corre en un entorno “sandboxed” **sin acceso completo a Node.js** (npm utilizable es limitado).
- Los resultados de steps se persisten en un **event log** para permitir replay.
- Debe ser **determinista** para poder re-ejecutarse y llegar al mismo punto durante una reanudación.
  - El framework ayuda a determinismo (por ejemplo, `Math.random` y `Date` son “fixed” durante replays).

Reglas prácticas para `@ekairos/structure`:
- Cambios dentro de `src/structure.ts` y cualquier función que se ejecute bajo `"use workflow"`:
  - **No** usar `Buffer`, `fs`, `child_process`, etc.
  - **No** hacer side effects directos: deben ir a steps.
  - Mantener IO serializable (JSON).
  - Usar steps para cualquier operación con sandbox/IO.

### `"use step"` (runtime extendido)

Qué significa:
- Los step functions hacen el “trabajo real” con **runtime completo** (Node.js + npm).
- Tienen **retry automático** (por defecto 3 intentos) y sus resultados se persisten para replay.

Reglas prácticas para `@ekairos/structure`:
- Cambios dentro de `src/*/steps.ts`:
  - Encapsular side effects y conversiones (base64, fetch binario, IO sandbox).
  - IO serializable (base64/string/JSON).
  - Diseñar steps de forma **funcional**: input → output (no mutación implícita).

Pass-by-value (muy importante para este módulo):
- Por serialización, los parámetros hacia un step se pasan **por valor**, no por referencia.
- Si pasas un objeto/array a un step y lo mutas, esos cambios **no vuelven** al workflow.
- Siempre retorna datos modificados explícitamente desde el step.

“use step” fuera de workflows:
- Si llamas una función `"use step"` **fuera** de un workflow, el directive es un **no-op** (se ejecuta como función normal).
- En ese caso no hay retries ni observabilidad del framework, y APIs específicas del workflow pueden fallar.

Suspensión/Reanudación (cómo aplica en `structure`):
- El workflow puede suspender al esperar:
  - un step (el workflow “cede” mientras el step corre)
  - sleeps/webhooks (si se usan)
- En nuestro harness (`workflow-smoke`), esto se observa en:
  - logs `[WebServer]` del server durante Playwright
  - trazas locales en `.next/workflow-data`

---

## 5) Interfaces del builder `structure()` (contrato externo)

Patrón de uso (conceptual):
- `structure(env, { datasetId? })`
- `.from(...)` para inputs (`text` | `file` | `dataset`)
- `.instructions(...)` (user instructions)
- `.auto()` o `.schema(outputSchema)`
- `.asRows()` o `.asObject()`
- `.build()` devuelve `{ datasetId, dataset? }` (y deja output persistido en contexto)

Salida esperada:
- Para object: `dataset.content.structure.outputs.object.value`
- Para rows: `event_contexts.structure_output_file` linkeado a `$files` con `output.jsonl`

---

## 6) Harness de desarrollo: `workflow-smoke` (probar `@ekairos/structure` en runtime durable)

`workflow-smoke` es un Next.js app que sirve para:
- ejecutar un workflow real (`"use workflow"`)
- ver logs del server durante Playwright
- inspeccionar trazas en disco (`.next/workflow-data`)

Archivos clave:
- Workflow: `packages/structure/workflow-smoke/src/lib/workflows/structure-smoke.workflow.ts`
- Route: `packages/structure/workflow-smoke/src/app/api/internal/workflow/structure-smoke/route.ts`
- Playwright: `packages/structure/workflow-smoke/playwright.config.ts`
- Trazas: `packages/structure/workflow-smoke/.next/workflow-data`

---

## 7) Cómo testear (E2E) y cómo hacer “follow-through” de una corrida

### Convención obligatoria de logs para tests (runId al inicio y al final)

Cada test E2E que dispare un workflow **debe** imprimir el `runId` (workflow id) en consola:
- **apenas lo obtiene** (inicio del test)
- **justo antes de terminar** (fin del test)

Motivo:
- En `workflow-smoke` puede haber runs viejos en `.next/workflow-data`. La forma correcta de debuggear es **buscar el `runId` en consola** y usarlo para abrir exactamente:
  - `.next/workflow-data/runs/<runId>.json`
  - `.next/workflow-data/steps/<runId>-step_*.json`

Recomendación práctica:
- Loguear con un marcador estable y grep-friendly, por ejemplo:
  - `WORKFLOW_RUN_ID_START=<runId>`
  - `WORKFLOW_RUN_ID_END=<runId>`

### Comando de test (desde repo root)

```powershell
pnpm --filter @ekairos/structure-workflow-smoke test:e2e
```

### Comando recomendado para correr *un test* (evitar “missing config”)

Si ejecutas Playwright fuera del directorio `packages/structure/workflow-smoke`, puede que **no detecte** el `playwright.config.ts` y falle con errores tipo *“missing config”* o `ECONNREFUSED` (porque no levanta el webServer en `:3011`).

Usa siempre este comando **desde** `packages/structure/workflow-smoke`:

```powershell
pnpm exec playwright test "tests/structure/<tu-test>.spec.ts" --config playwright.config.ts
```

### Evitar demoras por server “reusado” y asegurar logs `[WebServer]` (check de puerto 3011)

Caso típico:
- El test “corre”, pero **no aparecen logs** `[WebServer] ...` en la salida.

Causa:
- Playwright puede **reusar un server ya corriendo** en `http://127.0.0.1:3011` (por `reuseExistingServer: true` en local), y entonces **no pipea** logs del server (porque no lo levantó él).

Solución operativa (recomendado para debug y para evitar demoras):
- **Verifica/libera el puerto 3011 antes de correr**.
- **Fuerza `CI=1`** para que `reuseExistingServer` sea `false` y Playwright **levante** el `webServer` (logs visibles como `[WebServer]`).

Comando “todo en uno” (PowerShell):

```powershell
$procIds = @(Get-NetTCPConnection -LocalPort 3011 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Where-Object { $_ -gt 0 } | Select-Object -Unique); if ($procIds.Count -gt 0) { foreach ($procId in $procIds) { Stop-Process -Id $procId -Force } }; $env:CI=1; pnpm exec playwright test "tests/structure/<tu-test>.spec.ts" --config playwright.config.ts
```

### Follow-through (evidencia de punta a punta)

1) Del output del test, captura:
- `runId`
- `datasetId`

2) Abre la traza:
- `.next/workflow-data/runs/<runId>.json`
- `.next/workflow-data/steps/<runId>-step_*.json`

3) Confirma el resultado:
- En logs del route: `workflow returnValue` y `value (from returnValue)`
- En `runs/<runId>.json`: `status: completed` + `input` incluye `datasetId`



