import { compileWorkflowProject } from "@ekairos/workflow-compiler";

try {
  await compileWorkflowProject({ projectRoot: process.cwd() });
} catch (err) {
  console.error("[workflow-template] compile failed", err);
  process.exit(1);
}
