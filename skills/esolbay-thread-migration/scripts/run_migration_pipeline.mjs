#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFiles } from "./_env.mjs";
import { writeMigrationAudit } from "./_migration_audit.mjs";

const execFileAsync = promisify(execFile);
const envLoad = loadEnvFiles();

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function splitList(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveRepoPath(skillRoot) {
  const explicit = String(arg("repo", "")).trim();
  const candidates = [
    explicit,
    path.resolve(skillRoot, "..", "..", "..", "esolbay-platform"),
    path.resolve(process.cwd(), "..", "esolbay-platform"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fsSync.existsSync(resolved)) return resolved;
  }
  return "";
}

function resolveSchemaPath(repoPath, skillRoot) {
  const explicit = String(arg("schema-file", "")).trim();
  const candidates = [
    explicit,
    repoPath ? path.join(repoPath, "instant.schema.ts") : "",
    path.resolve(skillRoot, "..", "..", "..", "esolbay-platform", "instant.schema.ts"),
    path.resolve(process.cwd(), "..", "esolbay-platform", "instant.schema.ts"),
    path.resolve(process.cwd(), "instant.schema.ts"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fsSync.existsSync(resolved)) return resolved;
  }
  return "";
}

async function runStep(params) {
  const { id, scriptPath, args, cwd, logsDir } = params;
  const startedAt = new Date().toISOString();
  const stdoutFile = path.join(logsDir, `${id}.stdout.log`);
  const stderrFile = path.join(logsDir, `${id}.stderr.log`);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
    });
    await fs.writeFile(stdoutFile, String(stdout || ""), "utf8");
    await fs.writeFile(stderrFile, String(stderr || ""), "utf8");
    return { id, status: "ok", startedAt, endedAt: new Date().toISOString(), stdoutFile, stderrFile };
  } catch (error) {
    await fs.writeFile(stdoutFile, String(error?.stdout || ""), "utf8");
    await fs.writeFile(stderrFile, String(error?.stderr || error?.message || ""), "utf8");
    return {
      id,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      stdoutFile,
      stderrFile,
      error: String(error?.message || "unknown_error"),
    };
  }
}

async function main() {
  const mode = String(arg("mode", "planning")).trim().toLowerCase();
  if (mode !== "planning") {
    throw new Error(`Unsupported mode "${mode}". This pipeline is planning-only.`);
  }

  const scriptFile = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptFile);
  const skillRoot = path.resolve(scriptsDir, "..");
  const runId = String(arg("run-id", `mig-${Date.now()}`));
  const repoPath = resolveRepoPath(skillRoot);
  const schemaPath = resolveSchemaPath(repoPath, skillRoot);
  const orgIds = String(arg("org-ids", "")).trim();
  const allowUnsafe = hasFlag("allow-unsafe");
  const requireAllSafe = !allowUnsafe;
  const continueOnError = hasFlag("continue-on-error");

  const clerkSecret = String(process.env.CLERK_SECRET_KEY || "").trim();

  if (!repoPath) {
    throw new Error("Failed to resolve esolbay-platform repo path. Pass --repo.");
  }
  if (!schemaPath) {
    throw new Error("Failed to resolve instant schema path. Expected esolbay-platform/instant.schema.ts.");
  }
  if (!clerkSecret) {
    throw new Error("Missing CLERK_SECRET_KEY.");
  }

  const artifactsRoot = path.resolve(skillRoot, "artifacts");
  const reportsDir = path.join(artifactsRoot, "reports");
  const logsDir = path.join(artifactsRoot, "logs");
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const preflightOut = path.join(artifactsRoot, "preflight", "scan.json");
  const modelPlanJson = path.join(reportsDir, "story-thread-model-plan.json");
  const modelPlanMd = path.join(reportsDir, "story-thread-model-plan.md");
  const matrixOut = path.join(reportsDir, "schema-plan-org-matrix.json");
  const matrixMd = path.join(reportsDir, "schema-plan-org-matrix.md");
  const diagnosticsOut = path.join(reportsDir, "schema-plan-diagnostics.json");
  const diagnosticsMd = path.join(reportsDir, "schema-plan-diagnostics.md");
  const caseRunbookJson = path.join(reportsDir, "migration-case-runbook.json");
  const caseRunbookMd = path.join(reportsDir, "migration-case-runbook.md");
  const hotDeployGatesJson = path.join(reportsDir, "hot-deploy-gates.json");
  const migrationStatusJson = path.join(reportsDir, "migration-status.json");
  const validationSummaryJson = path.join(reportsDir, "pre-migration-validation.summary.json");
  const pipelineJson = path.join(reportsDir, `pipeline.${runId}.json`);

  await writeMigrationAudit({
    runId,
    script: "run_migration_pipeline",
    stage: "snapshot",
    payload: {
      mode,
      repoPath,
      schemaPath,
      orgIds,
      allowUnsafe,
      requireAllSafe,
      envFilesLoaded: envLoad.loaded,
      envFilesFailed: envLoad.failed,
      envAliasesApplied: envLoad.aliases,
    },
  });

  const steps = [
    {
      id: "01-verify_env",
      scriptPath: path.join(scriptsDir, "verify_env.mjs"),
      args: [],
    },
    {
      id: "02-preflight_scan",
      scriptPath: path.join(scriptsDir, "preflight_scan.mjs"),
      args: ["--repo", repoPath, "--out", preflightOut],
    },
    {
      id: "03-plan_story_thread_model_migration",
      scriptPath: path.join(scriptsDir, "plan_story_thread_model_migration.mjs"),
      args: ["--repo", repoPath, "--out-json", modelPlanJson, "--out-md", modelPlanMd],
    },
    {
      id: "04-plan_schema_push_org_matrix",
      scriptPath: path.join(scriptsDir, "plan_schema_push_org_matrix.mjs"),
      args: [
        "--schema-file",
        schemaPath,
        "--clerk-secret",
        clerkSecret,
        "--out",
        matrixOut,
        "--instructions-out",
        matrixMd,
        "--run-id",
        runId,
        ...(orgIds ? ["--org-ids", orgIds] : []),
        "--require-all-safe",
      ],
    },
    {
      id: "05-diagnose_plan_failures",
      scriptPath: path.join(scriptsDir, "diagnose_plan_failures.mjs"),
      args: [
        "--matrix",
        matrixOut,
        "--schema-file",
        schemaPath,
        "--clerk-secret",
        clerkSecret,
        "--out",
        diagnosticsOut,
        "--out-md",
        diagnosticsMd,
        "--run-id",
        runId,
      ],
    },
    {
      id: "06-build_case_runbook",
      scriptPath: path.join(scriptsDir, "build_case_runbook.mjs"),
      args: [
        "--matrix",
        matrixOut,
        "--diagnostics",
        diagnosticsOut,
        "--schema-file",
        schemaPath,
        "--out",
        caseRunbookJson,
        "--out-md",
        caseRunbookMd,
      ],
    },
    {
      id: "07-assert_hot_deploy_safe",
      scriptPath: path.join(scriptsDir, "assert_hot_deploy_safe.mjs"),
      args: [
        "--preflight",
        preflightOut,
        "--model-plan",
        modelPlanJson,
        "--matrix",
        matrixOut,
        "--out",
        hotDeployGatesJson,
        ...(allowUnsafe ? ["--allow-unsafe"] : []),
      ],
    },
  ];

  const results = [];
  for (const step of steps) {
    const result = await runStep({
      ...step,
      cwd: skillRoot,
      logsDir,
    });
    results.push(result);
    if (result.status === "failed" && !continueOnError) break;
  }

  if (fsSync.existsSync(matrixOut)) {
    const statusResult = await runStep({
      id: "08-report_migration_status",
      scriptPath: path.join(scriptsDir, "report_migration_status.mjs"),
      args: [
        "--matrix",
        matrixOut,
        "--out",
        migrationStatusJson,
        "--run-id",
        runId,
      ],
      cwd: skillRoot,
      logsDir,
    });
    results.push(statusResult);
  } else {
    results.push({
      id: "08-report_migration_status",
      status: "skipped",
      reason: `missing_matrix:${matrixOut}`,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
  }

  const orgList = splitList(orgIds);
  if (orgList.length > 0) {
    const validationRows = [];
    for (const orgId of orgList) {
      const safeStepId = orgId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const validationOut = path.join(
        reportsDir,
        `pre-migration-validation.${runId}.${safeStepId}.json`,
      );
      const validationResult = await runStep({
        id: `09-validate_pre_migration_bundle-${safeStepId}`,
        scriptPath: path.join(scriptsDir, "validate_pre_migration_bundle.mjs"),
        args: [
          "--repo",
          repoPath,
          "--schema-file",
          schemaPath,
          "--org",
          orgId,
          "--run-id",
          runId,
          "--out",
          validationOut,
        ],
        cwd: skillRoot,
        logsDir,
      });
      results.push(validationResult);
      validationRows.push({
        orgId,
        out: validationOut,
        stepStatus: validationResult.status,
        stepError: validationResult.error || "",
      });
      if (validationResult.status === "failed" && !continueOnError) break;
    }

    await fs.writeFile(
      validationSummaryJson,
      JSON.stringify(
        {
          runId,
          createdAt: new Date().toISOString(),
          orgIds: orgList,
          validations: validationRows,
        },
        null,
        2,
      ),
      "utf8",
    );
  } else {
    results.push({
      id: "09-validate_pre_migration_bundle",
      status: "skipped",
      reason: "no_org_ids_provided",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  const ok = summary.failed === 0;

  const pipeline = {
    ok,
    mode,
    runId,
    repoPath,
    schemaPath,
    summary,
    steps: results,
    artifacts: {
      preflightOut,
      modelPlanJson,
      modelPlanMd,
      matrixOut,
      matrixMd,
      diagnosticsOut,
      diagnosticsMd,
      caseRunbookJson,
      caseRunbookMd,
      hotDeployGatesJson,
      migrationStatusJson,
      validationSummaryJson,
      logsDir,
    },
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(pipelineJson, JSON.stringify(pipeline, null, 2), "utf8");

  await writeMigrationAudit({
    runId,
    script: "run_migration_pipeline",
    stage: "final",
    payload: {
      ok,
      summary,
      pipelineJson,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok,
        runId,
        summary,
        pipelineJson,
      },
      null,
      2,
    ),
  );

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
