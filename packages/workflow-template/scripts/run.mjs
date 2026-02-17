import { createLocalWorld } from "@workflow/world-local";
import { setWorld } from "workflow/runtime";
import { start } from "workflow/api";
import { resolve } from "node:path";

const dataDir =
  process.env.WORKFLOW_DATA_DIR || resolve(process.cwd(), ".workflow-data");

const world = createLocalWorld({ dataDir });
await world.start();
setWorld(world);

const input = process.env.WORKFLOW_INPUT
  ? JSON.parse(process.env.WORKFLOW_INPUT)
  : {
      orgId: process.env.ORG_ID || "",
      baseUrl: process.env.EKAIROS_DOMAIN_BASE_URL || "",
      token: process.env.EKAIROS_DOMAIN_OIDC_TOKEN || "",
      query: process.env.QUERY || "",
    };

const module = await import("../dist/session.workflow.js");
const workflowFn = module.runSession;
if (typeof workflowFn !== "function") {
  throw new Error("runSession export not found in dist/session.workflow.js");
}

const run = await start(workflowFn, [input]);
const result = await run.returnValue;
console.log(
  JSON.stringify(
    { runId: run.runId ?? null, returnValue: result?.value ?? null },
    null,
    2,
  ),
);
