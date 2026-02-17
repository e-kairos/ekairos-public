# Create Project Domain - Task Plan

## Domain Analysis
- Domain name: `project`
- Purpose: Manage projects and tasks with hierarchical task relationships and optional project assignment
- Entities:
  - `project_projects`: Main entity for projects
  - `project_tasks`: Tasks that can be related to projects and/or have parent-child relationships
- Relations:
  - `tasks <-> tasks`: Parent-child relationship (one parent, many children)
  - `task <- project`: Many tasks to one project (non-required)
- Operations:
  - Create project
  - Update project
  - Create task (parent optional, project optional) - constraint: if parent no project, if project no parent, can have neither
  - Update task
  - resolveTask(taskId, status, output) - resolves task with optional output
- Workflow:
  - `demoTask.workflow.ts`: Demo workflow that creates a task, logs execution, and resolves the task

## Implementation Plan

### Step 1: Create schema
- Define `project_projects` entity in `lib/domain/project/schema.ts`
- Define `project_tasks` entity with fields: status, output (optional)
- Define parent-child link between tasks (one parent, many children)
- Define link from tasks to projects (many tasks to one project, non-required)
- Compose domain in `lib/domain.ts`
- Push schema to InstantDB

### Step 2: Create service
- Implement ProjectService with create/update methods
- Implement TaskService with create/update/resolveTask methods
- Validate constraint: if parent no project, if project no parent
- Use @instantdb/admin for database operations

### Step 3: Create workflow
- Create `demoTask.workflow.ts` in `lib/domain/project/`
- Implement workflow that:
  - Creates a task (returns task id)
  - Logs "ejecucion dummy"
  - Resolves task with output: { taskId: taskId }

### Step 4: Create API routes
- POST /api/internal/project (create project)
- PUT /api/internal/project/[id] (update project)
- POST /api/internal/task (create task)
- PUT /api/internal/task/[id] (update task)
- POST /api/internal/task/[id]/resolve (resolve task)
- POST /api/internal/task/demo-task/workflow (execute demo workflow)

### Step 5: Create E2E tests
- Create `tests/playwright/project/project-api.spec.ts`
- Test project CRUD operations
- Test task CRUD operations
- Test resolveTask operation
- Test demoTask workflow endpoint
- Verify console.log output from workflow

## Execution Steps
1. ✅ Write domain plan (this document)
2. ✅ Create schema.ts
3. ✅ Compose domain in lib/domain.ts
4. ✅ Push schema (pnpm schema:push)
5. ✅ Create ProjectService
6. ✅ Create TaskService
7. ✅ Create demoTask.workflow.ts
8. ✅ Create API routes
9. ✅ Create E2E tests
10. ✅ Verify changes
11. ✅ Commit all changes

## Changes Made

### Domain Created: project
- **Entities:**
  - `project_projects`: Main entity with name, createdAt, updatedAt
  - `project_tasks`: Task entity with title, status, output (optional), createdAt, updatedAt

- **Links:**
  - `taskParent`: Self-referential link for parent-child relationships (one parent, many children)
  - `taskProject`: Link from tasks to projects (many tasks to one project, non-required)

- **Schema Changes:**
  - Created `src/lib/domain/project/schema.ts` with both entities and links
  - Composed domain in `src/lib/domain.ts` using `.includes(projectDomain)`
  - Schema pushed to InstantDB successfully

### Service Layer:
- **ProjectService** (`src/lib/domain/project/service.ts`):
  - `create(data: ProjectCreateData)`: Creates a new project with name validation
  - `update(id: string, data: ProjectUpdateData)`: Updates project name and updatedAt timestamp
  - `getById(id: string)`: Retrieves a project by ID
  - `list()`: Lists all projects

- **TaskService** (`src/lib/domain/project/service.ts`):
  - `create(data: TaskCreateData)`: Creates a task with validation that prevents both parent and project
  - `update(id: string, data: TaskUpdateData)`: Updates task with validation and link/unlink handling
  - `resolveTask(id: string, data: TaskResolveData)`: Resolves a task with status and optional output
  - `getById(id: string)`: Retrieves a task by ID
  - `list()`: Lists all tasks
  - **Validation:** Enforces constraint that task cannot have both parent and project simultaneously

### Workflow:
- **demoTask.workflow.ts** (`src/lib/domain/project/demoTask.workflow.ts`):
  - Main workflow function that orchestrates task creation and resolution
  - `createTask()` step: Creates a task with title "Demo Task"
  - `resolveTask()` step: Resolves the created task with status "completed" and output containing taskId
  - Logs "ejecucion dummy" to console during execution

### API Routes:
- **POST /api/internal/project** (`src/app/api/internal/project/route.ts`): Create project
- **GET /api/internal/project** (`src/app/api/internal/project/route.ts`): List projects
- **GET /api/internal/project/[id]** (`src/app/api/internal/project/[id]/route.ts`): Get project by ID
- **PUT /api/internal/project/[id]** (`src/app/api/internal/project/[id]/route.ts`): Update project
- **POST /api/internal/task** (`src/app/api/internal/task/route.ts`): Create task
- **GET /api/internal/task** (`src/app/api/internal/task/route.ts`): List tasks
- **GET /api/internal/task/[id]** (`src/app/api/internal/task/[id]/route.ts`): Get task by ID
- **PUT /api/internal/task/[id]** (`src/app/api/internal/task/[id]/route.ts`): Update task
- **POST /api/internal/task/[id]/resolve** (`src/app/api/internal/task/[id]/resolve/route.ts`): Resolve task
- **POST /api/internal/task/demo-task/workflow** (`src/app/api/internal/task/demo-task/workflow/route.ts`): Execute demoTask workflow

### Tests Created:
- **E2E Tests** (`tests/playwright/project/project-api.spec.ts`):
  - Project CRUD operations (create, list, get, update)
  - Task CRUD operations (create standalone, with project, with parent)
  - Validation test for task with both parent and project (should fail)
  - Task update operations
  - Task resolution with and without output
  - DemoTask workflow execution test
  - Test to verify task creation and resolution in workflow
  - Test to verify console.log output (structure prepared, though console.log verification in E2E tests is limited)

### Technical Decisions:
- Used `@instantdb/admin` for all database operations in services
- Services accept optional `db` parameter for dependency injection
- TaskService uses ProjectService for validation (injected dependency)
- Workflow uses TaskService to create and resolve tasks
- API routes initialize db once and share it between services
- Used `unlink` method for removing relationships when updating tasks
- Added validation to prevent unlink when relationship doesn't exist

## Rollback Plan
If something doesn't work:
1. `git reset --hard HEAD` to revert all changes
2. Review what went wrong
3. Update this plan document
4. Retry with corrected approach

## Notes
- Constraint: Task can have parent OR project, but not both. Can also have neither.
- Workflow demoTask creates a task, logs execution, and resolves it with output containing taskId.
- E2E tests should verify workflow execution and console.log output.

