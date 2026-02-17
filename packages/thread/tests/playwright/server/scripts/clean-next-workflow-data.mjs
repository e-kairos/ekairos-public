import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const workflowDataDir = resolve(process.cwd(), ".next", "workflow-data");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryRm(dir) {
  rmSync(dir, { recursive: true, force: true });
}

if (existsSync(workflowDataDir)) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      tryRm(workflowDataDir);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      sleep(150 * attempt);
    }
  }

  if (lastErr) {
    console.warn("[story-workflow-smoke] warning: failed to remove .next/workflow-data", String(lastErr?.message ?? lastErr));
  } else {
    console.log("[story-workflow-smoke] cleaned .next/workflow-data");
  }
}
