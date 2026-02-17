#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { writeMigrationAudit } from "./_migration_audit.mjs";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function gate(id, ok, detail) {
  return { id, ok: Boolean(ok), detail: String(detail || "") };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function evaluate(params) {
  const { preflight, modelPlan, matrix } = params;

  const g = [];
  g.push(
    gate(
      "preflight.endpoint_story_free",
      preflight?.readiness?.endpointStoryFree === true,
      `endpointStoryRefs=${toNumber(preflight?.counts?.endpointStoryRefs)}`,
    ),
  );
  g.push(
    gate(
      "preflight.agent_story_free",
      preflight?.readiness?.agentStoryFree === true,
      `agentStoryRefs=${toNumber(preflight?.counts?.agentStoryRefs)}`,
    ),
  );
  g.push(
    gate(
      "preflight.target_endpoints_thread_ready",
      preflight?.readiness?.targetAgentEndpointsReady === true,
      `endpointMissingThreadEvidence=${toNumber(preflight?.counts?.endpointMissingThreadEvidence)}`,
    ),
  );
  g.push(
    gate(
      "preflight.agent_reactor_present",
      preflight?.readiness?.agentReactorEvidencePresent === true,
      `agentReactorRefs=${toNumber(preflight?.counts?.agentReactorRefs)}`,
    ),
  );
  g.push(
    gate(
      "model.no_legacy_model_refs",
      toNumber(modelPlan?.summary?.legacyModelMatches) === 0,
      `legacyModelMatches=${toNumber(modelPlan?.summary?.legacyModelMatches)}`,
    ),
  );
  g.push(
    gate(
      "model.no_legacy_api_refs",
      toNumber(modelPlan?.summary?.legacyApiMatches) === 0,
      `legacyApiMatches=${toNumber(modelPlan?.summary?.legacyApiMatches)}`,
    ),
  );
  g.push(
    gate(
      "model.thread_api_present",
      toNumber(modelPlan?.summary?.threadApiMatches) > 0,
      `threadApiMatches=${toNumber(modelPlan?.summary?.threadApiMatches)}`,
    ),
  );
  g.push(
    gate(
      "model.thread_model_present",
      toNumber(modelPlan?.summary?.threadModelMatches) > 0,
      `threadModelMatches=${toNumber(modelPlan?.summary?.threadModelMatches)}`,
    ),
  );
  g.push(
    gate(
      "model.reactor_present",
      toNumber(modelPlan?.summary?.reactorMatches) > 0,
      `reactorMatches=${toNumber(modelPlan?.summary?.reactorMatches)}`,
    ),
  );
  g.push(
    gate(
      "matrix.no_blocked_orgs",
      toNumber(matrix?.summary?.blocked) === 0,
      `blocked=${toNumber(matrix?.summary?.blocked)}`,
    ),
  );
  g.push(
    gate(
      "matrix.no_failed_plans",
      toNumber(matrix?.summary?.plannedFailed) === 0,
      `plannedFailed=${toNumber(matrix?.summary?.plannedFailed)}`,
    ),
  );

  const failed = g.filter((item) => !item.ok);
  return {
    ok: failed.length === 0,
    totalGates: g.length,
    passedGates: g.length - failed.length,
    failedGates: failed.length,
    gates: g,
    blockers: failed,
  };
}

async function main() {
  const preflightPath = path.resolve(arg("preflight"));
  const modelPlanPath = path.resolve(arg("model-plan"));
  const matrixPath = path.resolve(arg("matrix"));
  const outPath = path.resolve(arg("out"));
  const runId = String(arg("run-id", `mig-${Date.now()}`));
  const allowUnsafe = hasFlag("allow-unsafe");

  if (!preflightPath || !modelPlanPath || !matrixPath || !outPath) {
    throw new Error(
      "usage: assert_hot_deploy_safe.mjs --preflight <scan.json> --model-plan <story-thread-model-plan.json> --matrix <schema-plan-org-matrix.json> --out <hot-deploy-gates.json> [--run-id id] [--allow-unsafe]",
    );
  }

  const [preflight, modelPlan, matrix] = await Promise.all([
    readJson(preflightPath),
    readJson(modelPlanPath),
    readJson(matrixPath),
  ]);

  await writeMigrationAudit({
    runId,
    script: "assert_hot_deploy_safe",
    stage: "snapshot",
    payload: {
      preflightPath,
      modelPlanPath,
      matrixPath,
      allowUnsafe,
    },
  });

  const evaluation = evaluate({ preflight, modelPlan, matrix });
  const report = {
    ok: evaluation.ok,
    allowUnsafe,
    runId,
    createdAt: new Date().toISOString(),
    inputs: {
      preflightPath,
      modelPlanPath,
      matrixPath,
    },
    evaluation,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  await writeMigrationAudit({
    runId,
    script: "assert_hot_deploy_safe",
    stage: "final",
    payload: {
      ok: report.ok,
      allowUnsafe,
      outPath,
      failedGates: evaluation.failedGates,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        allowUnsafe,
        failedGates: evaluation.failedGates,
        out: outPath,
      },
      null,
      2,
    ),
  );

  if (!report.ok && !allowUnsafe) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
