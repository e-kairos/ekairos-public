# Feature: Project Domain

## Descripción
Crear dominio "project" con entidades project_projects y project_tasks, relaciones parent-child entre tasks y relación many-to-one entre tasks y projects. Incluye operaciones CRUD, método resolveTask, y workflow demoTask para demostrar el uso de tasks.

## Commits

### Commit 1: e97f0ab - feat: add project domain with schema, service, workflow, API and E2E tests
**Fecha:** 2024-12-XX XX:XX:XX
**Tipo:** feat

**Cambios realizados:**
- Archivo creado: `src/lib/domain/project/schema.ts`
  - Define entidades project_projects y project_tasks
  - Define links para relaciones parent-child y task-project
  - Propósito: Schema del dominio project
  
- Archivo modificado: `src/lib/domain.ts`
  - Importa y compone projectDomain
  - Propósito: Integrar el dominio project en el schema de la aplicación
  
- Archivo creado: `src/lib/domain/project/service.ts`
  - Implementa ProjectService con métodos CRUD
  - Implementa TaskService con métodos CRUD y resolveTask
  - Validación de constraint: task no puede tener parent y project simultáneamente
  - Propósito: Lógica de negocio del dominio project
  
- Archivo creado: `src/lib/domain/project/demoTask.workflow.ts`
  - Workflow que crea una tarea, loguea "ejecucion dummy", y resuelve la tarea
  - Propósito: Demostrar el uso de workflows con tasks
  
- Archivo creado: `src/app/api/internal/project/route.ts`
  - POST para crear proyectos
  - GET para listar proyectos
  - Propósito: Endpoints API para proyectos
  
- Archivo creado: `src/app/api/internal/project/[id]/route.ts`
  - GET para obtener proyecto por ID
  - PUT para actualizar proyecto
  - Propósito: Endpoints API para operaciones individuales de proyectos
  
- Archivo creado: `src/app/api/internal/task/route.ts`
  - POST para crear tareas
  - GET para listar tareas
  - Propósito: Endpoints API para tareas
  
- Archivo creado: `src/app/api/internal/task/[id]/route.ts`
  - GET para obtener tarea por ID
  - PUT para actualizar tarea
  - Propósito: Endpoints API para operaciones individuales de tareas
  
- Archivo creado: `src/app/api/internal/task/[id]/resolve/route.ts`
  - POST para resolver tarea con status y output opcional
  - Propósito: Endpoint API para resolver tareas
  
- Archivo creado: `src/app/api/internal/task/demo-task/workflow/route.ts`
  - POST para ejecutar workflow demoTask
  - Propósito: Endpoint API para ejecutar workflow de demostración
  
- Archivo creado: `tests/playwright/project/project-api.spec.ts`
  - Tests E2E para todas las operaciones CRUD de proyectos
  - Tests E2E para todas las operaciones CRUD de tareas
  - Tests de validación de constraint parent/project
  - Tests para workflow demoTask
  - Propósito: Verificar funcionalidad completa del dominio

**Tests ejecutados:**
- `pnpm schema:push`: ✅ Schema pusheado exitosamente
- `read_lints`: ✅ Sin errores de linting

**Notas:**
- Constraint implementada: Task no puede tener parent y project simultáneamente
- Workflow demoTask crea tarea, loguea "ejecucion dummy", y resuelve la tarea con output
- Tests E2E cubren todas las operaciones principales del dominio

