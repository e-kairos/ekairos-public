# Guía de Primer Release - Ekairos

Esta guía te lleva paso a paso para publicar la primera versión de los paquetes de Ekairos en npm.

## ✅ Pre-requisitos Completados

- [x] Monorepo estructurado
- [x] Paquetes configurados
- [x] Build exitoso
- [x] Tests del workbench pasando
- [x] Links funcionando correctamente

## 🚀 Hacer el Primer Release

### Paso 1: Verificar autenticación npm

```bash
npm login
# Ingresa tus credenciales de npmjs.com
# Verifica que estás logueado en la org correcta:
npm whoami
```

### Paso 2: Build completo

```bash
cd c:\Users\aleja\storias\projects\pulzar\pulzar-lib-core
pnpm build
```

Verifica que todos los paquetes compilaron:
```
✓ @ekairos/domain
✓ @ekairos/story
✓ @ekairos/dataset
✓ ekairos
```

### Paso 3: Publicar paquetes

**IMPORTANTE**: Publicar en este orden (respetando dependencias):

```bash
# 1. Domain (no tiene dependencias internas)
pnpm --filter @ekairos/domain publish --access public

# 2. Story (depende de domain)
pnpm --filter @ekairos/story publish --access public

# 3. Ekairos (depende de story y domain)
pnpm --filter ekairos publish --access public

# 4. Dataset (depende de story)
pnpm --filter @ekairos/dataset publish --access public
```

### Paso 4: Verificar en npm

```bash
# Verificar que se publicaron correctamente
npm view ekairos
npm view @ekairos/story
npm view @ekairos/domain
npm view @ekairos/dataset
```

### Paso 5: Crear tag en git

```bash
git tag v1.6.0
git push origin v1.6.0
```

## 🧪 Probar la instalación

Crea un nuevo proyecto de prueba:

```bash
cd c:\temp
mkdir test-ekairos
cd test-ekairos
pnpm init
pnpm add ekairos
```

Crea un archivo de prueba `test.js`:

```javascript
const { story, engine } = require('ekairos');

console.log('✓ ekairos imported successfully');
console.log('- story:', typeof story);
console.log('- engine:', typeof engine);

// Test básico
const testStory = {
  key: 'test',
  narrative: 'Test',
  actions: [{
    name: 'test',
    description: 'Test action',
    implementationKey: 'test',
    execute: async () => ({ ok: true })
  }]
};

const registered = engine.register(testStory);
console.log('✓ Story registered');

const descriptor = registered.story('test');
console.log('✓ Descriptor generated:', descriptor.key);
```

Ejecutar:
```bash
node test.js
```

## 📦 Uso en proyectos

Después del release, los usuarios podrán instalar:

```bash
# Paquete principal - Core runtime (story + domain)
pnpm add ekairos

# Paquete separado - Dataset tools
pnpm add @ekairos/dataset
```

**Importante:** `ekairos` NO incluye `@ekairos/dataset`. Son paquetes independientes.

Uso:

```typescript
// Opción 1: Desde el paquete principal
import { story, engine, storyRunner } from 'ekairos';

// Opción 2: Desde paquetes específicos
import { story } from '@ekairos/story';
import { domain } from '@ekairos/domain';
import { DatasetService } from '@ekairos/dataset';

// Para workflows con Next.js:
// 1. next.config.ts
import { withWorkflow } from 'workflow/next';
const config = { transpilePackages: ['ekairos'] };
export default withWorkflow(config);

// 2. stories.ts
import { story, engine } from 'ekairos';
const myStory = { /* ... */ };
export const storyEngine = engine.register(myStory);
export const descriptor = storyEngine.story('my-story');

// 3. app/workflows/my-story.ts
import { storyRunner } from 'ekairos';
import { descriptor } from '@/stories';

export async function myWorkflow(args) {
  "use workflow";
  return storyRunner(descriptor, args);
}

// 4. route.ts
import { start } from 'workflow/api';
import { myWorkflow } from '@/app/workflows/my-story';

export async function POST() {
  await start(myWorkflow);
  return new Response('OK');
}
```

## 🔄 Releases Subsecuentes

Para releases futuros, usa los scripts automatizados `ship:*`:

```bash
# Asegúrate de tener el working directory limpio
git status

# Para un release minor (nuevas features, cambios compatibles)
pnpm ship:minor

# Para un release patch (bug fixes)
pnpm ship:patch

# Para un release major (breaking changes)
pnpm ship:major

# Para un release beta (pre-release)
pnpm ship:beta
```

**¿Qué hace cada script?**

Los scripts `ship:*` automáticamente:
1. ✅ Actualizan la versión del workspace con `npm version`
2. ✅ Construyen solo los paquetes publicables (excluye `ekairos-core`)
3. ✅ Ejecutan `prepare-publish` para actualizar versiones de paquetes
4. ✅ Hacen commit automático de los cambios
5. ✅ Publican los paquetes en npm

**Nota importante:** El paquete `ekairos-core` (web) se excluye automáticamente del build durante la publicación, ya que es una aplicación Next.js y no se publica en npm.

## 📝 Notas

- Los números de versión siguen [Semantic Versioning](https://semver.org/)
- `ekairos` y `@ekairos/story` deben tener la misma versión (son el mismo paquete conceptualmente)
- `@ekairos/domain` puede tener versión independiente (cambia raramente)
- `@ekairos/dataset` puede tener versión independiente

## ⚠️ Troubleshooting

**Error: "You do not have permission to publish"**
- Verifica que estás autenticado: `npm whoami`
- Verifica permisos en la org `ekairos` en npmjs.com

**Error: "Cannot publish over existing version"**
- Incrementa la versión en `package.json` antes de publicar
- O usa `pnpm changeset version` para hacerlo automáticamente

**Error: "Package name too similar to existing package"**
- Verifica que el nombre `ekairos` está disponible
- Si ya existe, usa un nombre alternativo (ej: `@ekairos/core`)

