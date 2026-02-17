# Guía de Release Automatizado - Ekairos

Esta guía explica cómo hacer releases de los paquetes de Ekairos usando los scripts automatizados del workspace.

## 📋 Pre-requisitos

Antes de hacer un release, asegúrate de:

- [ ] Estar autenticado en npm: `npm whoami`
- [ ] Tener permisos de publicación en la org `@ekairos`
- [ ] Tener el working directory limpio: `git status`
- [ ] Estar en la rama correcta (típicamente `main` o `feat/publish-ekairos`)
- [ ] Haber hecho commit de todos los cambios que quieres incluir en el release

## 🚀 Scripts Disponibles

El workspace incluye scripts automatizados para diferentes tipos de releases:

### `pnpm ship:patch`
Para releases de tipo **patch** (bug fixes, cambios menores):
- Incrementa: `1.15.0` → `1.15.1`
- Uso: Correcciones de bugs, ajustes menores

### `pnpm ship:minor`
Para releases de tipo **minor** (nuevas features, cambios compatibles):
- Incrementa: `1.15.0` → `1.16.0`
- Uso: Nuevas funcionalidades, mejoras que no rompen compatibilidad

### `pnpm ship:major`
Para releases de tipo **major** (breaking changes):
- Incrementa: `1.15.0` → `2.0.0`
- Uso: Cambios que rompen compatibilidad con versiones anteriores

### `pnpm ship:beta`
Para releases **beta** (pre-releases):
- Incrementa: `1.15.0` → `1.15.1-beta.0`
- Uso: Versiones de prueba antes de un release estable

## 📝 Proceso de Release

### Paso 1: Verificar Estado

```bash
# Verificar autenticación npm
npm whoami

# Verificar estado de git
git status

# Verificar que estás en la rama correcta
git branch
```

### Paso 2: Ejecutar el Script de Release

Elige el tipo de release según el tipo de cambios:

```bash
# Para bug fixes
pnpm ship:patch

# Para nuevas features (recomendado)
pnpm ship:minor

# Para breaking changes
pnpm ship:major

# Para pre-releases
pnpm ship:beta
```

### Paso 3: Verificar el Resultado

El script ejecuta automáticamente:

1. **Actualización de versión**: `npm version <tipo>` actualiza la versión del workspace
2. **Build**: Construye solo los paquetes publicables:
   - `@ekairos/domain`
   - `@ekairos/story`
   - `ekairos`
   - `@ekairos/dummy-workflow`
   - **Excluye**: `ekairos-core` (aplicación Next.js, no se publica)
3. **Preparación**: `prepare-publish` actualiza las versiones de los paquetes individuales
4. **Commit**: Hace commit automático con mensaje `"chore: prepare packages for publication"`
5. **Publicación**: Publica los paquetes en npm en el orden correcto

### Paso 4: Verificar Publicación

```bash
# Verificar que los paquetes se publicaron correctamente
npm view @ekairos/domain
npm view @ekairos/story
npm view ekairos
```

## 🔍 Qué Paquetes se Publican

Los siguientes paquetes se publican automáticamente:

- ✅ `@ekairos/domain` - Utilidades de dominio
- ✅ `@ekairos/story` - Motor de historias
- ✅ `ekairos` - Paquete principal (wrapper)
- ✅ `@ekairos/dummy-workflow` - Workflow dummy para testing

**No se publica:**
- ❌ `ekairos-core` - Aplicación Next.js (paquete privado)

## ⚙️ Detalles Técnicos

### Exclusión de `ekairos-core`

El paquete `ekairos-core` (ubicado en `packages/web`) se excluye automáticamente del build durante la publicación porque:

1. Es una aplicación Next.js, no una librería
2. Tiene dependencias complejas (`workflow`, `@ai-sdk/*`) que causan problemas en el build
3. No está destinado a ser publicado en npm

El filtro usado es: `--filter=!ekairos-core`

### Orden de Publicación

Los paquetes se publican en este orden (respetando dependencias):

1. `@ekairos/domain` (no tiene dependencias internas)
2. `@ekairos/story` (depende de domain)
3. `ekairos` (depende de story y domain)
4. `@ekairos/dummy-workflow` (depende de story)

### Versiones

- El workspace principal (`pulzar-workspace`) usa versiones semánticas
- Los paquetes individuales se sincronizan automáticamente con `prepare-publish`
- Los tags de git se crean automáticamente con `npm version`

## 🐛 Troubleshooting

### Error: "Git working directory not clean"

**Causa**: Hay cambios sin commitear.

**Solución**:
```bash
# Ver qué cambios hay
git status

# Opción 1: Hacer commit de los cambios
git add .
git commit -m "feat: descripción de cambios"
pnpm ship:minor

# Opción 2: Descartar cambios si no son necesarios
git restore .
```

### Error: "tag already exists"

**Causa**: El tag de la versión ya existe en git.

**Solución**:
```bash
# Eliminar el tag local
git tag -d v1.15.0

# Si también existe en remoto, eliminarlo allí
git push origin --delete v1.15.0

# Luego ejecutar el script de nuevo
pnpm ship:minor
```

### Error: "You do not have permission to publish"

**Causa**: No estás autenticado o no tienes permisos.

**Solución**:
```bash
# Verificar autenticación
npm whoami

# Si no estás autenticado, hacer login
npm login

# Verificar permisos en npmjs.com para la org @ekairos
```

### Error: "Cannot publish over existing version"

**Causa**: La versión ya existe en npm.

**Solución**:
```bash
# Verificar versión actual en npm
npm view @ekairos/domain version

# Usar un tipo de release diferente (patch → minor → major)
# O esperar a que el script incremente la versión correctamente
```

### Error de Build: "Could not resolve @workflow/core/_workflow"

**Causa**: Este error NO debería ocurrir porque `ekairos-core` está excluido.

**Solución**: Si ocurre, verificar que el filtro `--filter=!ekairos-core` está presente en los scripts `ship:*`.

## 📊 Flujo Completo de Release

```bash
# 1. Preparación
git checkout main
git pull origin main
git status  # Verificar que está limpio

# 2. Verificar autenticación
npm whoami

# 3. Ejecutar release
pnpm ship:minor

# 4. Verificar publicación
npm view @ekairos/domain version
npm view @ekairos/story version
npm view ekairos version

# 5. Push de tags (si es necesario)
git push --follow-tags
```

## 🔄 Release Manual (No Recomendado)

Si necesitas hacer un release manual por alguna razón:

```bash
# 1. Actualizar versión manualmente
npm version minor

# 2. Build excluyendo ekairos-core
turbo build --filter=!ekairos-core

# 3. Preparar paquetes
pnpm run prepare-publish

# 4. Commit
git add .
git commit -m "chore: prepare packages for publication"

# 5. Publicar
pnpm run publish:latest
```

**Nota**: Se recomienda usar los scripts `ship:*` en lugar de hacerlo manualmente.

## 📚 Referencias

- [Semantic Versioning](https://semver.org/)
- [npm version](https://docs.npmjs.com/cli/v10/commands/npm-version)
- [Turbo Filters](https://turbo.build/repo/docs/core-concepts/monorepos/filtering)

## ✅ Checklist de Release

Antes de ejecutar `ship:*`, verifica:

- [ ] Todos los cambios están commiteados
- [ ] Working directory está limpio (`git status`)
- [ ] Estás autenticado en npm (`npm whoami`)
- [ ] Tienes permisos de publicación
- [ ] Los tests pasan (`pnpm test`)
- [ ] El build funciona (`pnpm build`)
- [ ] Estás en la rama correcta
- [ ] Has elegido el tipo de release correcto (patch/minor/major/beta)

Después del release:

- [ ] Verificar que los paquetes se publicaron (`npm view`)
- [ ] Verificar que los tags de git se crearon (`git tag`)
- [ ] Hacer push de tags si es necesario (`git push --follow-tags`)
- [ ] Notificar al equipo si es necesario


