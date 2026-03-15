#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { loadEnvFiles } from "./_env.mjs";

const envLoad = loadEnvFiles();

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseIssuePriority(issueCode) {
  const critical = new Set(["invalid_admin_token", "instant_app_not_found", "missing_instant_credentials"]);
  if (critical.has(issueCode)) return "critical";
  if (issueCode === "schema_duplicate_link") return "high";
  return "medium";
}

function commandForOrgMatrix(schemaFile, orgId, outFile, outMd) {
  return [
    "node scripts/plan_schema_push_org_matrix.mjs",
    `--schema-file "${schemaFile}"`,
    `--clerk-secret "$CLERK_SECRET_KEY"`,
    `--org-ids "${orgId}"`,
    `--out "${outFile}"`,
    `--instructions-out "${outMd}"`,
  ].join(" ");
}

function commandForSinglePlan(appId, schemaFile, outFile, outMd, runIdSuffix) {
  return [
    "node scripts/plan_schema_push.mjs",
    `--app-id "${appId}"`,
    '--admin-token "<ADMIN_TOKEN_FROM_CLERK_PRIVATE_METADATA>"',
    `--schema-file "${schemaFile}"`,
    `--out "${outFile}"`,
    `--instructions-out "${outMd}"`,
    `--run-id "${runIdSuffix}"`,
  ].join(" ");
}

function commandForPhase1Schema(schemaFile, diagnosticsFile, outSchema, outMd, removedLinks) {
  const removeArg = removedLinks.length > 0 ? `--remove-links "${removedLinks.join(",")}"` : "";
  return [
    "node scripts/generate_phase1_schema.mjs",
    `--schema-file "${schemaFile}"`,
    `--diagnostics "${diagnosticsFile}"`,
    removeArg,
    `--out "${outSchema}"`,
    `--out-md "${outMd}"`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildSchemaDuplicateActions(params) {
  const caseDir = params.caseDir;
  const phase1Schema = path.join(caseDir, "schema-phase1.json");
  const phase1Md = path.join(caseDir, "schema-phase1.md");
  const phase1PlanJson = path.join(caseDir, "phase1-plan.json");
  const phase1PlanMd = path.join(caseDir, "phase1-plan.md");
  const phase2PlanJson = path.join(caseDir, "phase2-plan.json");
  const phase2PlanMd = path.join(caseDir, "phase2-plan.md");
  const orgMatrixJson = path.join(caseDir, "post-phase2-org-matrix.json");
  const orgMatrixMd = path.join(caseDir, "post-phase2-org-matrix.md");
  const removedLinks = Array.isArray(params.row?.sanitizedPlan?.removedLinks)
    ? params.row.sanitizedPlan.removedLinks.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  return [
    {
      id: "01-confirm-legacy-owner",
      title: "Confirm legacy link owner from diagnostics",
      kind: "manual_check",
      details:
        "Verify the identity collision target and legacy owner in diagnostics before generating transitional schema.",
    },
    {
      id: "02-generate-phase1-schema",
      title: "Generate transitional schema (phase 1) for this case",
      kind: "command",
      command: commandForPhase1Schema(
        params.schemaFile,
        params.diagnosticsFile,
        phase1Schema,
        phase1Md,
        removedLinks,
      ),
    },
    {
      id: "03-plan-phase1",
      title: "Plan schema push with transitional schema (phase 1)",
      kind: "command",
      command: commandForSinglePlan(
        params.appId,
        phase1Schema,
        phase1PlanJson,
        phase1PlanMd,
        `${params.caseId}-phase1`,
      ),
    },
    {
      id: "04-apply-phase1",
      title: "Apply phase 1 schema manually",
      kind: "human_gate",
      details:
        "Apply the phase 1 schema through approved internal ops (no auto-apply in this skill). Capture approval evidence.",
    },
    {
      id: "05-plan-phase2",
      title: "Plan schema push with full target schema (phase 2)",
      kind: "command",
      command: commandForSinglePlan(
        params.appId,
        params.schemaFile,
        phase2PlanJson,
        phase2PlanMd,
        `${params.caseId}-phase2`,
      ),
    },
    {
      id: "06-apply-phase2",
      title: "Apply phase 2 schema manually",
      kind: "human_gate",
      details:
        "Apply full target schema through approved internal ops after phase 2 plan is clean.",
    },
    {
      id: "07-org-verification",
      title: "Re-run org matrix for this org only",
      kind: "command",
      command: commandForOrgMatrix(params.schemaFile, params.orgId, orgMatrixJson, orgMatrixMd),
    },
  ];
}

function buildInvalidTokenActions(params) {
  const caseDir = params.caseDir;
  const orgMatrixJson = path.join(caseDir, "post-token-rotation-org-matrix.json");
  const orgMatrixMd = path.join(caseDir, "post-token-rotation-org-matrix.md");
  return [
    {
      id: "01-rotate-token",
      title: "Rotate admin token in Instant dashboard",
      kind: "human_gate",
      details: "Create a fresh admin token for the app.",
    },
    {
      id: "02-update-clerk",
      title: "Update Clerk private metadata",
      kind: "human_gate",
      details: `Set privateMetadata.instant.adminToken for org ${params.orgId}.`,
    },
    {
      id: "03-replan-org",
      title: "Re-run planning for this org",
      kind: "command",
      command: commandForOrgMatrix(params.schemaFile, params.orgId, orgMatrixJson, orgMatrixMd),
    },
  ];
}

function buildMissingCredsActions(params) {
  const caseDir = params.caseDir;
  const orgMatrixJson = path.join(caseDir, "post-credentials-org-matrix.json");
  const orgMatrixMd = path.join(caseDir, "post-credentials-org-matrix.md");
  return [
    {
      id: "01-fill-appid",
      title: "Set Clerk privateMetadata.instant.appId",
      kind: "human_gate",
      details: `Populate appId for org ${params.orgId}.`,
    },
    {
      id: "02-fill-token",
      title: "Set Clerk privateMetadata.instant.adminToken",
      kind: "human_gate",
      details: `Populate adminToken for org ${params.orgId}.`,
    },
    {
      id: "03-replan-org",
      title: "Re-run planning for this org",
      kind: "command",
      command: commandForOrgMatrix(params.schemaFile, params.orgId, orgMatrixJson, orgMatrixMd),
    },
  ];
}

function buildAppNotFoundActions(params) {
  const caseDir = params.caseDir;
  const orgMatrixJson = path.join(caseDir, "post-app-fix-org-matrix.json");
  const orgMatrixMd = path.join(caseDir, "post-app-fix-org-matrix.md");
  return [
    {
      id: "01-check-appid",
      title: "Validate appId ownership and existence",
      kind: "human_gate",
      details: `Confirm app ${params.appId} exists and belongs to target workspace.`,
    },
    {
      id: "02-fix-metadata",
      title: "Fix Clerk appId metadata if needed",
      kind: "human_gate",
      details: `Update privateMetadata.instant.appId for org ${params.orgId}.`,
    },
    {
      id: "03-replan-org",
      title: "Re-run planning for this org",
      kind: "command",
      command: commandForOrgMatrix(params.schemaFile, params.orgId, orgMatrixJson, orgMatrixMd),
    },
  ];
}

function buildGenericActions(params) {
  const caseDir = params.caseDir;
  const orgMatrixJson = path.join(caseDir, "post-fix-org-matrix.json");
  const orgMatrixMd = path.join(caseDir, "post-fix-org-matrix.md");
  return [
    {
      id: "01-inspect-error",
      title: "Inspect raw planner error",
      kind: "manual_check",
      details: "Review full plan error payload in diagnostics.",
    },
    {
      id: "02-targeted-fix",
      title: "Apply targeted fix manually",
      kind: "human_gate",
      details: "Resolve the specific blocking condition before re-planning.",
    },
    {
      id: "03-replan-org",
      title: "Re-run planning for this org",
      kind: "command",
      command: commandForOrgMatrix(params.schemaFile, params.orgId, orgMatrixJson, orgMatrixMd),
    },
  ];
}

function buildActionsForCase(params) {
  const issueCode = params.issueCode;
  if (issueCode === "schema_duplicate_link") return buildSchemaDuplicateActions(params);
  if (issueCode === "invalid_admin_token") return buildInvalidTokenActions(params);
  if (issueCode === "missing_instant_credentials") return buildMissingCredsActions(params);
  if (issueCode === "instant_app_not_found") return buildAppNotFoundActions(params);
  return buildGenericActions(params);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Migration Case Runbook");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Source schema: \`${report.schemaFile}\``);
  lines.push(`- Total cases: **${report.summary.totalCases}**`);
  lines.push(`- Blocking cases: **${report.summary.blockingCases}**`);
  lines.push("");
  lines.push("## Principles");
  lines.push("");
  lines.push("- No automatic schema/data apply is performed by this runbook.");
  lines.push("- Execute intermediate actions case by case with human approval gates.");
  lines.push("- Re-plan after each case before moving to next wave.");
  lines.push("");
  lines.push("## Case Summary");
  lines.push("");
  for (const [issue, count] of Object.entries(report.summary.countByIssue)) {
    lines.push(`- ${issue}: **${count}**`);
  }
  lines.push("");

  for (const item of report.cases) {
    lines.push(`## ${item.caseId}`);
    lines.push("");
    lines.push(`- Org: \`${item.org.id}\` (${item.org.name || "n/a"})`);
    lines.push(`- App: ${item.appId ? `\`${item.appId}\`` : "missing"}`);
    lines.push(`- Issue: \`${item.issueCode}\``);
    lines.push(`- Priority: \`${item.priority}\``);
    lines.push("");
    lines.push("### Intermediate Actions");
    lines.push("");
    for (const action of item.actions) {
      lines.push(`1. **${action.title}** (${action.kind})`);
      if (action.details) lines.push(`   - ${action.details}`);
      if (action.command) lines.push(`   - \`${action.command}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const matrixFile = path.resolve(arg("matrix", ".\\artifacts\\reports\\schema-plan-org-matrix.json"));
  const diagnosticsFile = path.resolve(arg("diagnostics", ".\\artifacts\\reports\\schema-plan-diagnostics.json"));
  const schemaFile = path.resolve(arg("schema-file", ".\\instant.schema.ts"));
  const outFile = path.resolve(arg("out", ".\\artifacts\\reports\\migration-case-runbook.json"));
  const outMd = path.resolve(arg("out-md", ".\\artifacts\\reports\\migration-case-runbook.md"));
  const casesRoot = path.resolve(arg("cases-dir", ".\\artifacts\\cases"));

  if (!fsSync.existsSync(matrixFile)) throw new Error(`Matrix file not found: ${matrixFile}`);
  if (!fsSync.existsSync(diagnosticsFile)) throw new Error(`Diagnostics file not found: ${diagnosticsFile}`);
  if (!fsSync.existsSync(schemaFile)) throw new Error(`Schema file not found: ${schemaFile}`);

  const matrix = JSON.parse(await fs.readFile(matrixFile, "utf8"));
  const diagnostics = JSON.parse(await fs.readFile(diagnosticsFile, "utf8"));
  const rows = Array.isArray(diagnostics?.diagnostics) ? diagnostics.diagnostics : [];
  const matrixRows = Array.isArray(matrix?.rows) ? matrix.rows : [];

  const cases = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const issueCode = String(row?.issueCode || "unknown_plan_error");
    const orgId = String(row?.org?.id || "").trim();
    if (!orgId) continue;
    const orgName = String(row?.org?.name || "");
    const appId = String(row?.appId || "").trim();
    const caseId = `case-${String(index + 1).padStart(2, "0")}-${slug(orgId)}`;
    const caseDir = path.join(casesRoot, caseId);
    const matrixRow = matrixRows.find((item) => String(item?.org?.id || "") === orgId) || null;

    const actions = buildActionsForCase({
      issueCode,
      row,
      matrixRow,
      caseId,
      caseDir,
      appId,
      orgId,
      schemaFile,
      diagnosticsFile,
    });

    cases.push({
      caseId,
      org: { id: orgId, name: orgName },
      appId: appId || null,
      issueCode,
      priority: parseIssuePriority(issueCode),
      planError: String(row?.planError || ""),
      actions,
    });
  }

  const countByIssue = {};
  for (const entry of cases) {
    countByIssue[entry.issueCode] = (countByIssue[entry.issueCode] || 0) + 1;
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    matrixFile,
    diagnosticsFile,
    schemaFile,
    casesRoot,
    summary: {
      totalCases: cases.length,
      blockingCases: cases.length,
      countByIssue,
    },
    cases,
    meta: {
      envFilesLoaded: envLoad.loaded,
      envFilesFailed: envLoad.failed,
      envAliasesApplied: envLoad.aliases,
    },
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
  await fs.mkdir(path.dirname(outMd), { recursive: true });
  await fs.writeFile(outMd, renderMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile,
        outMd,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

