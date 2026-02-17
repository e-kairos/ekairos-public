# Migración a Monorepo - Pulzar Lib Core

## ✅ Completado

### Estructura creada
```
pulzar-lib-core/
├── packages/
│   ├── core/          # @ekairos/core - Runtime base de agentes
│   ├── story/         # @ekairos/story - Sistema de historias con workflows
│   ├── domain/        # @ekairos/domain - Utilidades de dominio
│   └── dataset/       # @ekairos/dataset - Herramientas de datasets
├── workbench/
│   └── example/       # Ejemplo de uso de @ekairos/story
├── pnpm-workspace.yaml
├── turbo.json
└── package.json (workspace root)
```

### Archivos copiados
- ✅ `src/domain/*` → `packages/domain/src/`
- ✅ `src/dataset/*` → `packages/dataset/src/`
- ✅ `src/agent/agent.ts, events.ts, service.ts, etc.` → `packages/core/src/`
- ✅ `src/agent/steps/*` (excepto engine.ts) → `packages/core/src/steps/`
- ✅ `src/agent/story.ts, storyEngine.ts, storyRunner.ts` → `packages/story/src/`
- ✅ `src/agent/steps/engine.ts` → `packages/story/src/engine.ts`

### Configuración
- ✅ `package.json` para cada paquete
- ✅ `tsconfig.json` para cada paquete
- ✅ `pnpm-workspace.yaml` con catalog de dependencias
- ✅ `turbo.json` para builds en paralelo
- ✅ `workbench/example` con ejemplo funcional

## 🚧 Pendiente

### 1. Actualizar imports en packages/story
Los archivos en `packages/story/src/` aún tienen imports relativos que deben apuntar a `@pulz-ar/core`:

**Archivos a actualizar:**
- `packages/story/src/story.ts`
- `packages/story/src/storyRunner.ts`
- `packages/story/src/engine.ts`

**Cambios necesarios:**
```typescript
// Antes:
import { ContextIdentifier } from "./service"
import { ensureContextStep } from "./steps/context"

// Después:
import { ContextIdentifier } from "@ekairos/core"
import { ensureContextStep } from "@ekairos/core/steps/context"
```

### 2. Crear index.ts para domain y dataset
**packages/domain/src/index.ts:**
```typescript
export * from "./index"
```

**packages/dataset/src/index.ts:**
```typescript
export * from "./index"
export * from "./domain"
// ... otros exports según corresponda
```

### 3. Actualizar exports en packages/core
El archivo `packages/core/package.json` necesita exports adicionales:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./agent": "./dist/agent.js",
    "./steps": "./dist/steps/index.js",
    "./steps/context": "./dist/steps/context.js",
    "./steps/ai": "./dist/steps/ai.js",
    "./steps/base": "./dist/steps/base.js",
    "./service": "./dist/service.js",
    "./events": "./dist/events.js"
  }
}
```

### 4. Instalar dependencias
```bash
cd C:\Users\aleja\storias\projects\pulzar\pulzar-lib-core
pnpm install
```

### 5. Build inicial
```bash
pnpm build
```

### 6. Probar workbench
```bash
pnpm --filter @pulzar/example-workbench dev
```

## 📋 Comandos útiles

```bash
# Instalar dependencias
pnpm install

# Build de todos los paquetes
pnpm build

# Build de un paquete específico
pnpm --filter @ekairos/core build

# Dev mode (watch)
pnpm dev

# Limpiar builds
pnpm clean

# Typecheck
pnpm typecheck

# Correr workbench
pnpm --filter @ekairos/example-workbench dev
```

## 🔄 Workflow de desarrollo

1. **Hacer cambios en packages/core o packages/story**
2. **Build automático con turbo** (en watch mode con `pnpm dev`)
3. **Probar en workbench/example**
4. **Publicar paquetes** cuando estén listos:
   ```bash
   pnpm --filter @ekairos/core publish
   pnpm --filter @ekairos/story publish
   pnpm --filter @ekairos/domain publish
   pnpm --filter @ekairos/dataset publish
   ```

## 📦 Publicación

Los paquetes se pueden publicar independientemente:
- `@ekairos/core` - Core del agente
- `@ekairos/story` - Sistema de historias (depende de core)
- `@ekairos/domain` - Utilidades de dominio
- `@ekairos/dataset` - Herramientas de datasets (depende de core)

## 🎯 Próximos pasos

1. **Completar migración de imports** (sección Pendiente #1)
2. **Crear index.ts faltantes** (sección Pendiente #2)
3. **Actualizar exports** (sección Pendiente #3)
4. **Instalar y build** (secciones Pendientes #4 y #5)
5. **Migrar agentes existentes** (`file-dataset.agent.ts`, `transform-dataset.agent.ts`)
6. **Actualizar tests** para trabajar con el monorepo
7. **Documentar cada paquete** con READMEs individuales

## 📚 Referencias

- Estructura inspirada en: [Vercel Workflow](https://github.com/vercel/workflow)
- pnpm workspaces: https://pnpm.io/workspaces
- Turborepo: https://turbo.build/repo/docs

