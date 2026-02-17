## Fix first release – working agreement

### 1. Objetivo

- **Verificar el agente punta a punta** usando el paquete `ekairos`:
  - Durante el desarrollo: `packages/web` usa **workspace** (`workspace:*`) para probar cambios locales sin publicar.
  - En el release real: `packages/web` apunta a la **última versión publicada en npm** (`npm:ekairos@x.y.z-beta.n`) para validar como lo haría un cliente.

### 2. Flujo de desarrollo (antes de publicar)

1. **Dependencias de `web` apuntando al workspace**
   - En `packages/web/package.json`:
     - `ekairos`: `"workspace:*"`
     - `@ekairos/domain`: `"workspace:*"`
   - Ejecutar:
     ```bash
     pnpm --filter ekairos-core install
     ```

2. **Tests del agente solamente**
   - Unit / eval (Vitest):
     ```bash
     pnpm --filter ekairos-core test
     ```
   - E2E del agente (Playwright, sólo el spec del agente):
     ```bash
     cd packages/web
     pnpm exec playwright test tests/playwright/agent-chat.spec.ts
     ```

3. **Condiciones de éxito del test E2E**
   - La página `/test-agent` carga y muestra:
     - Input con `data-testid="chat-input"`.
     - Botón con `data-testid="send-button"`.
     - Contenedor con `data-testid="chat-container"`.
   - Al enviar un mensaje:
     - Aparece el mensaje del usuario con `data-testid="message-user"`.
     - Aparece un mensaje del agente con `data-testid="message-assistant"` y texto de longitud razonable.
   - El bloque de eval:
     - Usa `AI_GATEWAY_API_KEY` (y opcionalmente `AI_GATEWAY_URL`) vía `createOpenAI`.
     - Si el gateway devuelve error (por ejemplo, `invalid_api_key`), el test **no falla por eso**: la aserción mínima es que `responseText` no esté vacío.

### 3. Flujo de release (publish real)

1. **Apuntar `web` a la versión publicada en npm**
   - En `packages/web/package.json`, reemplazar:
     - `ekairos`: `"workspace:*"` → `"npm:ekairos@<última-versión-beta-o-latest>"`
     - `@ekairos/domain`: `"workspace:*"` → `"npm:@ekairos/domain@<última-versión-beta-o-latest>"`
   - Ejecutar:
     ```bash
     pnpm --filter ekairos-core install
     ```

2. **Secuencia de comandos de release**
   - Desde el root del repo:
     ```bash
     pnpm test
     pnpm run prepare-publish
     pnpm ship:beta   # o ship:patch / ship:minor según corresponda
     ```
   - `ship:*` hace internamente:
     1. `npm version ...` (bump + tag).
     2. `turbo build --filter=!ekairos-core`.
     3. `pnpm run prepare-publish`:
        - `pnpm run test` (incluye Vitest + build de paquetes).
        - `scripts/prepare-publish.js` (ajusta `package.json` de cada paquete).
     4. `git add . && git commit -m "chore: prepare ..."` (automático).
     5. `publish:latest` / `publish:beta` (publica en npm).

3. **Después de publicar**
   - Confirmar en npm:
     - `@ekairos/domain@<versión>`
     - `@ekairos/story@<versión>`
     - `ekairos@<versión>`
   - Actualizar `packages/web/package.json` a esa versión publicada para el siguiente ciclo:
     - Mantener siempre `npm:ekairos@<última-versión>` y `npm:@ekairos/domain@<última-versión>` como **estado base** de la rama.

### 4. Hygienización de repo

1. **`node_modules`**
   - Nunca deben entrar en git:
     - `.gitignore` ya contiene:
       - `/node_modules`
       - `**/node_modules`
   - Si por error se trackean:
     - Sacarlos del índice (sin borrar del disco), por ejemplo:
       ```bash
       git rm -r --cached packages/story/node_modules
       ```

2. **Archivos `.env`**
   - `packages/web/.env` y `packages/web/.env.test`:
     - Deben existir sólo localmente (para desarrollo / CI), nunca en git.
   - `.gitignore` ya ignora `*.env*`, así que:
     - Asegurarse de que no estén en `git status`.
     - Si alguna vez se volvieran a trackear:
       ```bash
       git rm --cached packages/web/.env packages/web/.env.test
       ```
   - Si se filtró una key sensible en el historial (como `AI_GATEWAY_API_KEY`), es obligatorio:
     - Rotar la key en el proveedor.
     - Opcionalmente, reescribir el historial (`git filter-repo`) para borrar los archivos afectados.

### 5. Apps efímeras de Instant para cada ciclo

1. **Obtener token del CLI (una sola vez por cuenta)**
   - Ejecutar localmente:
     ```bash
     npx instant-cli@latest login -p
     ```
   - Copiar el token y guardarlo en `.env` como `INSTANT_CLI_AUTH_TOKEN`.
   - Este token permite automatizar comandos sin volver a abrir el navegador.

2. **Crear una app temporal**
   - Desde `packages/web` (con `INSTANT_CLI_AUTH_TOKEN` en el entorno):
     ```bash
     npx instant-cli@latest init-without-files \
       --temp \
       --title "ekairos-agent-e2e-<timestamp>" \
       --token $env:INSTANT_CLI_AUTH_TOKEN
     ```
   - El comando devuelve `appId` y `adminToken`.

3. **Actualizar `.env` local**
   ```
   NEXT_PUBLIC_INSTANT_APP_ID=<appId>
   INSTANT_APP_ADMIN_TOKEN=<adminToken>
   AI_GATEWAY_API_KEY=...
   UPSTASH_REDIS_REST_URL=redis://localhost:6379
   UPSTASH_REDIS_REST_TOKEN=
   UPSTASH_REALTIME_REST_TOKEN=test-token
   INSTANT_CLI_AUTH_TOKEN=<token del paso 1>
   ```

4. **Empujar el schema/perms a la app recién creada**
   - Asegúrate de exportar las variables en la sesión actual (PowerShell):
     ```powershell
     $env:NEXT_PUBLIC_INSTANT_APP_ID="<appId>"
     $env:INSTANT_APP_ADMIN_TOKEN="<adminToken>"
     $env:INSTANT_CLI_AUTH_TOKEN="<token login>"
     pnpm run schema:push
     ```
   - `schema:push` ejecuta `npx instant-cli@latest push schema` y requiere que el token sea válido en la cuenta que creó la app (si el CLI responde `Record not found: app`, el token no tiene acceso a ese `appId`).

5. **Ejecutar el test E2E**
   ```bash
   pnpm test:e2e   # ya incluye schema:push antes de Playwright
   ```

> Nota: Si `schema:push` sigue fallando con `Record not found: app` incluso con el token exportado, es necesario volver a ejecutar `npx instant-cli@latest login -p` y verificar que el token corresponda a la misma cuenta donde se creó la app temporal.


