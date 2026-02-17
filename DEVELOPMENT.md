## Desarrollo Local de la UI de Ekairos

Esta guía resume el flujo que debe seguir cualquier contributor (humano o agente) para trabajar en los componentes de la UI usando el registry local y el CLI de Ekairos. El objetivo es tener un procedimiento reproducible antes de tocar `packages/web`.

---

### 1. Prerrequisitos

- Node 20.x y pnpm 10.x (ya definidos en el repo).
- Registry local (`packages/registry`) y CLI (`packages/cli`) incluidos en el monorepo.
- PowerShell o cmd disponibles (los ejemplos muestran ambos).

---

### 2. Levantar el Registry en Local

1. Abrir una consola en `packages/registry`.
2. Definir el host del registry para que coincida con el puerto donde servirá Next.js. En desarrollo usamos `3030`:

```powershell
cd packages/registry
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3030"
$env:PORT = "3030"
pnpm dev
```

> El handler (`app/[component]/route.ts`) usa `NEXT_PUBLIC_APP_URL` para construir `http://localhost:3030/{component}.json`. Si no se define, cae al fallback `http://localhost:3001`.

---

### 3. Configurar el Proyecto Web

El CLI (o shadcn) siempre lee `packages/web/components.json`. Asegúrate de que el registry apunte a tu puerto local **sin** espacios ni sufijos extra:

```json
"registries": {
  "@ekairos": "http://localhost:3030/{name}.json"
}
```

Si el CLI reescribe el archivo con otro puerto, vuelve a editarlo antes de continuar.

---

### 4. Usar el CLI contra el Registry Local

Puedes usar el binario publicado (`npx ekairos@latest`) o el build local (`node packages/cli/dist/index.js`). Para automatizar tareas (bandera `--action`) se recomienda el build local.

#### 4.1. Iniciar sesión async

```powershell
cd packages/web
set EKAIROS_REGISTRY_URL=http://localhost:3030/registry.json
node ..\cli\dist\index.js --async
# -> devuelve un sessionId
```

#### 4.2. Ejecutar acciones

```powershell
node ..\cli\dist\index.js --session <sessionId> --action update-all
```

Esto descargará los componentes del registry (por ejemplo `agent`) y sobrescribirá los archivos en `packages/web/src/components/ekairos/...`.

> Si aparece una URL con `%20` (`registry.json%20/...`) es porque `components.json` contiene espacios. Corrígelo y repite el proceso.

---

### 5. Verificar Cambios en `web`

Tras correr el CLI:

1. Revisa los diffs en `packages/web/src/components/ekairos/...`.
2. Asegúrate de que sólo existan cambios provenientes del registry (no ediciones manuales).
3. Ejecuta las pruebas necesarias (`pnpm --filter ekairos-core test`) si vas a subir un cambio funcional.

---

### 6. Flujo de Trabajo Recomendado

1. **Editar en `packages/registry`**: modifica el componente fuente (p. ej., `components/ekairos/prompt/prompt-button-reasoning.tsx`).
2. **Levantar el registry**: `pnpm dev` con `NEXT_PUBLIC_APP_URL=http://localhost:3030`.
3. **Ejecutar el CLI**: `node ..\cli\dist\index.js --session … --action update-all`.
4. **Validar en `packages/web`**: confirma que el componente recibió la actualización.
5. **Versionar / publicar** según corresponda (release beta/estable usando `RELEASE.md`).

---

### 7. Problemas Frecuentes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| El CLI intenta conectarse a `http://localhost:3001` | `components.json` o `NEXT_PUBLIC_APP_URL` no apuntan al mismo host que el registry | Edita `components.json` y vuelve a ejecutar el CLI con `EKAIROS_REGISTRY_URL=http://localhost:3030/registry.json` |
| `registry.json%20/...` en la URL | Hay un espacio antes del `/{name}.json` | Corrige la cadena en `components.json` |
| `Component not found` | El archivo no existe en `packages/registry/components` | Verifica la ruta y reinicia el servidor para refrescar la caché |

---

Con este flujo, cualquier agente o contribuidor puede trabajar sobre la UI de Ekairos en local, garantizando que todos los cambios lleguen primero al registry antes de sincronizar `packages/web`.  


