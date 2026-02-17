# Workflow (Next + Turbopack): SWC plugin `mode: "client"` elimina imports y deja bindings libres (`ReferenceError`)

## Resumen

En proyectos Next (Turbopack) usando `@workflow/next`, el loader aplica el SWC plugin `@workflow/swc-plugin` con `mode: "client"` a **cualquier archivo** que contenga el string `use step` o `use workflow` (búsqueda por regex, no por AST).

El plugin termina **eliminando `import ... from ...`** del módulo transformado, pero **NO reescribe** los usos de esos bindings dentro del step, por lo que quedan identificadores libres en runtime (ej. `DatasetService`, `gateway`, `getWritable`, etc.) y falla con `ReferenceError: X is not defined`.

Adicionalmente, como el loader sólo busca el substring `use step|use workflow`, basta con tenerlo en un **comentario** para que se transforme un módulo que ni siquiera declara la directiva, lo cual puede romper imports “normales” de runtime.

## Impacto

- Los módulos con steps que usan imports estáticos dentro del cuerpo del step fallan en runtime:
  - `ReferenceError: DatasetService is not defined`
  - `ReferenceError: gateway is not defined`
- Módulos sin directivas reales (sólo comentarios que mencionan `"use step"`) también se transforman, generando comportamientos inesperados.

## Versiones / entorno

- Windows 10/11
- Node 20.x
- Next (Turbopack) *(repro observado en Next 15/16)*
- `@workflow/next`: 4.0.1-beta.3 *(observado en otras betas también)*
- `@workflow/swc-plugin`: observado con 4.0.1-beta.12

## Evidencia (código del loader)

El loader de `@workflow/next` decide aplicar la transformación por regex:

```js
// @workflow/next/dist/loader.js
if (!normalizedSource.match(/(use step|use workflow)/)) {
  return normalizedSource;
}

const result = await transform(normalizedSource, {
  jsc: {
    experimental: {
      plugins: [[require.resolve('@workflow/swc-plugin'), { mode: 'client' }]],
    },
  },
});
```

## Repro mínimo

1) Crear un módulo que exporte un step:

```js
import { Something } from "./something";

export async function myStep() {
  "use step";
  return new Something().run();
}
```

2) Correr en Next con `@workflow/next` habilitado (Turbopack) y ejecutar el step.

### Resultado observado

Tras el transform (modo `client`), el output queda conceptualmente así:

```js
export async function myStep() {
  const x = new Something(); // <-- `Something` queda libre (import eliminado)
}
```

Y en runtime:

```
ReferenceError: Something is not defined
```

## Repro con script (sin Next)

Este script ejecuta exactamente el mismo transform que hace `@workflow/next/dist/loader.js` usando su propio `@swc/core` y resolviendo `@workflow/swc-plugin` desde el contexto del loader:

```bash
node -e "const fs=require('fs'); const {createRequire}=require('module'); \
const loaderPath='.../node_modules/@workflow/next/dist/loader.js'; \
const req=createRequire(loaderPath); const swc=req('@swc/core'); \
const plugin=req.resolve('@workflow/swc-plugin'); \
const code=fs.readFileSync('path/al/archivo.js','utf8'); \
const out=swc.transformSync(code,{filename:'x.js', jsc:{parser:{syntax:'ecmascript'}, target:'es2022', experimental:{plugins:[[plugin,{mode:'client'}]]}}, minify:false}); \
console.log(out.code);"
```

## Causa raíz

- El loader decide transformar **por substring**, no por directiva AST real.
- El plugin `mode: "client"` elimina `import` declarations del módulo, dejando usos de símbolos importados sin binding.

## Soluciones posibles (para discusión)

### Opción A — Loader: detección por AST + scope correcto

- En vez de regex por substring, parsear el módulo y detectar directivas reales (`"use step"` / `"use workflow"`) en el body de funciones / módulos.
- Asegurar que el loader se aplique sólo donde corresponde (p. ej. no transformar módulos server/app-route o `node_modules` indiscriminadamente).

### Opción B — Plugin: preservar imports o reescribir bindings

Si el plugin necesita eliminar imports, entonces debe:

- Reescribir cada identificador importado usado en step a una forma segura (p. ej. usar `__private_getClosureVars()` + referencias explícitas), **o**
- Preservar imports de runtime necesarios cuando el target es server (o cuando `mode` no es realmente “client”).

### Opción C — Modos separados para server/client

El loader actualmente fuerza `{ mode: "client" }` incluso para bundles server/app-route. Debería existir un camino claro:

- `mode: "server"` para steps (Node runtime)
- `mode: "client"` sólo para client-only transforms

## Workaround aplicado (para desbloquear)

Mientras se resuelve, el workaround robusto es:

- Evitar imports estáticos en módulos con `"use step"`, y usar `await import(...)` dentro del step.
- Evitar mencionar `use step` / `use workflow` en comentarios de módulos que no requieren el transform (por el match por substring).

