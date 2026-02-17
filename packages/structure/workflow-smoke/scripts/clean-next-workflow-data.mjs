import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const workflowDataDir = resolve(process.cwd(), ".next", "workflow-data");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryRm(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Best-effort cleanup to avoid Next build failing on Windows with ENOTEMPTY when removing
// `.next/workflow-data/*` directories.
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
    // Don't fail the build; log and let Next handle it if it can.
    console.warn("[workflow-smoke] warning: failed to remove .next/workflow-data", String(lastErr?.message ?? lastErr));
  } else {
    console.log("[workflow-smoke] cleaned .next/workflow-data");
  }
}

