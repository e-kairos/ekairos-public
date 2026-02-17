# Ekairos Registry

Registry de componentes compatible con shadcn CLI para distribuir componentes de UI de Ekairos.

## Uso

### 1. Iniciar el Registry

```bash
pnpm --filter registry dev
```

Servidor disponible en `http://localhost:3001`

### 2. Importar componentes en proyectos

En `packages/web/components.json` está configurado:

```json
{
  "registries": {
    "@ekairos": "http://localhost:3001/{name}.json"
  }
}
```

Para importar un componente:

```bash
cd packages/web
pnpm dlx shadcn@latest add @ekairos/agent
```

### 3. Flujo de desarrollo

1. Editar componentes en `packages/registry/components/ekairos/`
2. El servidor recarga automáticamente (hot reload)
3. Re-importar en web: `pnpm dlx shadcn@latest add @ekairos/{component-name}`
4. Los cambios se copian a `packages/web/src/components/ekairos/`

## Estructura

- `components/ekairos/`: Componentes principales
- `components/ai-elements/`: Componentes base de AI SDK
- `app/[component]/route.ts`: API route que expone componentes

## Ver componentes disponibles

```bash
curl http://localhost:3001/registry
```

