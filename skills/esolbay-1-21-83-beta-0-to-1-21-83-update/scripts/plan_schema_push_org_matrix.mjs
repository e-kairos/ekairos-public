#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFiles } from "./_env.mjs";
import { writeMigrationAudit } from "./_migration_audit.mjs";

const envLoad = loadEnvFiles();
const execFileAsync = promisify(execFile);

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeApiUri(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/\/+$/, "");
}

function resolveSchemaFileInput(value, repoPath = "") {
  const explicit = String(value || "").trim();
  const candidates = [
    explicit,
    repoPath ? path.join(repoPath, "instant.schema.ts") : "",
    path.resolve(process.cwd(), "instant.schema.ts"),
    path.resolve(process.cwd(), "..", "esolbay-platform", "instant.schema.ts"),
    path.resolve(process.cwd(), "..", "..", "esolbay-platform", "instant.schema.ts"),
    path.resolve(process.cwd(), "..", "..", "..", "esolbay-platform", "instant.schema.ts"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      const stat = fsSync.statSync(resolved);
      if (stat.isFile()) return resolved;
    } catch {
      // continue
    }
  }
  return "";
}

function splitList(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function identityFromStep(step) {
  if (Array.isArray(step?.forwardIdentity) && step.forwardIdentity.length >= 3) {
    return `${String(step.forwardIdentity[1])}.${String(step.forwardIdentity[2])}`;
  }
  if (step?.attr?.forwardIdentity && Array.isArray(step.attr.forwardIdentity) && step.attr.forwardIdentity.length >= 3) {
    return `${String(step.attr.forwardIdentity[1])}.${String(step.attr.forwardIdentity[2])}`;
  }
  return null;
}

function classifyStep(step) {
  const type = String(step?.type || "unknown");
  const critical = new Set(["delete-attr", "update-attr", "unique", "required", "check-data-type"]);
  const warning = new Set(["remove-unique", "remove-required", "remove-index", "remove-data-type"]);
  const safe = new Set(["add-attr", "index"]);
  if (critical.has(type)) return "critical";
  if (warning.has(type)) return "warning";
  if (safe.has(type)) return "safe";
  return "review";
}

function summarizeSteps(steps) {
  const countsBySeverity = {
    critical: 0,
    warning: 0,
    review: 0,
    safe: 0,
  };
  const countsByType = {};
  for (const step of steps) {
    const severity = classifyStep(step);
    countsBySeverity[severity] += 1;
    const type = String(step?.type || "unknown");
    countsByType[type] = (countsByType[type] || 0) + 1;
  }
  return {
    total: steps.length,
    countsBySeverity,
    countsByType,
  };
}

function toInstruction(step, index) {
  return {
    index: index + 1,
    type: String(step?.type || "unknown"),
    severity: classifyStep(step),
    target: identityFromStep(step),
    summary: String(step?.friendlyDescription || ""),
  };
}

function inferPlanErrorKind(message) {
  const text = String(message || "").toLowerCase();
  const accountMismatchHints = [
    "missing role collaborator",
    "missing role",
    "user-role",
    "permission denied",
    "forbidden",
    "unauthorized",
    "not authorized",
    "not allowed",
    "does not have access",
    "no access",
    "not a member",
  ];
  if (accountMismatchHints.some((hint) => text.includes(hint))) {
    return "account_mismatch";
  }
  return "plan_error";
}

function inferPlanIssueCode(row) {
  const message = String(row?.plan?.error || "").toLowerCase();
  if (
    row?.plan?.status === "skipped" &&
    (row?.plan?.reason === "missing_instant_app_id" ||
      row?.plan?.reason === "missing_instant_credentials")
  ) {
    return "missing_instant_credentials";
  }
  if (row?.plan?.status === "ok") return "plan_ok";
  if (message.includes("record not found: token")) return "invalid_admin_token";
  if (row?.plan?.errorKind === "account_mismatch") return "account_mismatch";
  if (message.includes("duplicate entry found for attribute")) return "schema_duplicate_link";
  if (message.includes("record not found: app")) return "instant_app_not_found";
  return "unknown_plan_error";
}

function buildActionPlan(row) {
  const appId = String(row?.instant?.appId || "");
  const issueCode = inferPlanIssueCode(row);

  if (issueCode === "plan_ok") {
    return {
      planId: "OK-000",
      issueCode,
      blocking: false,
      title: "Ready for rollout",
      steps: ["Include this app in the next rollout wave."],
    };
  }

  if (issueCode === "account_mismatch") {
    return {
      planId: "ACC-001",
      issueCode,
      blocking: true,
      title: "App linked to another Instant account",
      steps: [
        "No migration action in this run.",
        "Keep app in report and exclude from deploy gate.",
        "Optional later: request collaborator access on the target app and rerun planning.",
      ],
    };
  }

  if (issueCode === "schema_duplicate_link") {
    return {
      planId: "SCH-001",
      issueCode,
      blocking: true,
      title: "Link identity collision (legacy vs target schema)",
      steps: [
        "Run diagnostics and confirm legacy owner for `organization_organizations->externalConnections` in current app schema.",
        "Use two-phase schema rollout: phase 1 removes only conflicting target link(s), phase 2 reapplies full target schema.",
        `Per-app check: \`node plan_schema_push.mjs --app-id ${appId} --admin-token <instant-admin-token> --schema-file <path-to-instant.schema.ts> --print-output\`.`,
        "After phase 2 planning is clean, mark app as ready for migration execution.",
      ],
    };
  }

  if (issueCode === "invalid_admin_token") {
    return {
      planId: "TOK-001",
      issueCode,
      blocking: true,
      title: "Invalid or stale Instant admin token in Clerk metadata",
      steps: [
        "Rotate/regenerate app admin token in Instant dashboard.",
        "Update Clerk `privateMetadata.instant.adminToken` for this organization.",
        "Rerun matrix planning for this organization.",
      ],
    };
  }

  if (issueCode === "instant_app_not_found") {
    return {
      planId: "APP-404",
      issueCode,
      blocking: true,
      title: "Clerk metadata references missing Instant app",
      steps: [
        `Verify whether app \`${appId}\` exists in Instant workspace.`,
        "If deleted or moved, update Clerk `privateMetadata.instant.appId` to the correct app or clear stale value.",
        "Rerun matrix planning after metadata update.",
      ],
    };
  }

  if (issueCode === "missing_instant_credentials") {
    return {
      planId: "CREDS-001",
      issueCode,
      blocking: true,
      title: "Missing Instant credentials in Clerk org metadata",
      steps: [
        "Populate `privateMetadata.instant.appId` and `privateMetadata.instant.adminToken` for the organization.",
        "Rerun matrix planning.",
      ],
    };
  }

  return {
    planId: "GEN-001",
    issueCode,
    blocking: true,
    title: "Unhandled planning error",
    steps: [
      "Inspect row error details in JSON report.",
      "Create targeted fix and rerun planning for the app.",
    ],
  };
}

async function loadSchemaViaTsx(schemaPath) {
  const tmpScript = path.join(
    os.tmpdir(),
    `ekairos-load-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  const loaderCode = [
    'import { pathToFileURL } from "node:url";',
    "const target = process.argv[2];",
    'if (!target) throw new Error("missing schema path");',
    "const mod = await import(pathToFileURL(target).href);",
    "const schema = mod.default ?? mod.schema ?? mod.appSchema ?? mod.instantSchema ?? mod;",
    "process.stdout.write(JSON.stringify(schema));",
    "",
  ].join("\n");

  await fs.writeFile(tmpScript, loaderCode, "utf8");
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", tmpScript, schemaPath],
      {
        cwd: path.dirname(schemaPath),
        maxBuffer: 1024 * 1024 * 50,
        windowsHide: true,
      },
    );
    return JSON.parse(String(stdout || "").replace(/^\uFEFF/, ""));
  } finally {
    await fs.rm(tmpScript, { force: true });
  }
}

async function resolveSchema(schemaFile) {
  const resolved = path.resolve(schemaFile);
  const ext = path.extname(resolved).toLowerCase();
  const content = await fs.readFile(resolved, "utf8");

  if (ext === ".json") {
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (parsed && typeof parsed === "object" && parsed.schema && typeof parsed.schema === "object") {
      return { schema: parsed.schema, schemaSource: resolved, schemaType: "json:wrapped" };
    }
    return { schema: parsed, schemaSource: resolved, schemaType: "json" };
  }

  if (ext === ".ts" || ext === ".mts" || ext === ".tsx") {
    let helper;
    try {
      helper = await import("@instantdb/platform");
    } catch {
      helper = null;
    }
    if (helper && typeof helper.schemaTypescriptFileToInstantSchema === "function") {
      const schema = helper.schemaTypescriptFileToInstantSchema(content);
      return { schema, schemaSource: resolved, schemaType: "typescript" };
    }
    const schema = await loadSchemaViaTsx(resolved);
    return { schema, schemaSource: resolved, schemaType: "typescript:tsx" };
  }

  throw new Error(`Unsupported schema file extension: ${ext}. Use .json or .ts`);
}

function extractOrganizationsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

async function listClerkOrganizations(params) {
  const out = [];
  let offset = 0;
  const limit = Math.max(1, Math.min(100, Number(params.limit || 100)));
  while (true) {
    const url = new URL(`${params.clerkApiUri}/v1/organizations`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${params.clerkSecretKey}`,
        accept: "application/json",
      },
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { rawText: text };
    }
    if (!response.ok) {
      throw new Error(`Failed to list Clerk organizations (${response.status}): ${JSON.stringify(payload)}`);
    }

    const rows = extractOrganizationsPayload(payload);
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

async function getClerkOrganization(clerkApiUri, clerkSecretKey, organizationId) {
  const url = `${clerkApiUri}/v1/organizations/${encodeURIComponent(organizationId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${clerkSecretKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`Failed to read Clerk organization ${organizationId} (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function extractInstantCredentials(orgPayload) {
  const privateMetadata =
    orgPayload && typeof orgPayload.private_metadata === "object" && orgPayload.private_metadata
      ? orgPayload.private_metadata
      : orgPayload && typeof orgPayload.privateMetadata === "object" && orgPayload.privateMetadata
        ? orgPayload.privateMetadata
        : {};
  const instant = privateMetadata && typeof privateMetadata.instant === "object" && privateMetadata.instant ? privateMetadata.instant : {};
  const appId = typeof instant.appId === "string" ? instant.appId.trim() : "";
  const adminToken = typeof instant.adminToken === "string" ? instant.adminToken.trim() : "";
  return {
    appId,
    adminToken,
  };
}

async function planForApp(params) {
  const endpoint = `${params.instantApiUri}/superadmin/apps/${encodeURIComponent(params.appId)}/schema/push/plan`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.adminToken}`,
    },
    body: JSON.stringify({
      schema: params.schema,
    }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`planSchemaPush failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const summary = summarizeSteps(steps);
  const instructions = steps.map((step, index) => toInstruction(step, index));
  return {
    endpoint,
    steps,
    summary,
    instructions,
    payload,
  };
}

function createMatrixSummary(rows) {
  const mismatchAppIds = new Set();
  const summary = {
    totalOrgs: rows.length,
    withInstantCredentials: 0,
    missingInstantCredentials: 0,
    plannedOk: 0,
    plannedFailed: 0,
    safe: 0,
    reviewRequired: 0,
    blocked: 0,
    totalSteps: 0,
    totalCritical: 0,
    totalWarning: 0,
    accountMismatchRows: 0,
    accountMismatchCount: 0,
    accountMismatchAppIds: [],
  };
  for (const row of rows) {
    if (row.instant?.hasAppId && row.instant?.hasAdminToken) summary.withInstantCredentials += 1;
    else summary.missingInstantCredentials += 1;

    if (row.plan?.status === "ok") {
      summary.plannedOk += 1;
      summary.totalSteps += Number(row.plan.summary?.total || 0);
      summary.totalCritical += Number(row.plan.summary?.countsBySeverity?.critical || 0);
      summary.totalWarning += Number(row.plan.summary?.countsBySeverity?.warning || 0);
      if (row.plan.gate === "safe") summary.safe += 1;
      else if (row.plan.gate === "review") summary.reviewRequired += 1;
      else summary.blocked += 1;
    } else if (row.plan?.status === "error") {
      summary.plannedFailed += 1;
      summary.blocked += 1;
      if (row.plan?.errorKind === "account_mismatch") {
        summary.accountMismatchRows += 1;
        if (row.instant?.appId) mismatchAppIds.add(String(row.instant.appId));
      }
    } else {
      summary.reviewRequired += 1;
    }
  }
  summary.accountMismatchAppIds = Array.from(mismatchAppIds);
  summary.accountMismatchCount = summary.accountMismatchAppIds.length;
  return summary;
}

function collectAccountMismatchApps(rows) {
  const out = [];
  for (const row of rows) {
    if (row.plan?.status !== "error") continue;
    if (row.plan?.errorKind !== "account_mismatch") continue;
    if (!row.instant?.appId) continue;
    out.push({
      appId: String(row.instant.appId),
      orgId: String(row.org?.id || ""),
      orgName: String(row.org?.name || ""),
      orgSlug: String(row.org?.slug || ""),
      error: String(row.plan?.error || ""),
    });
  }
  return out;
}

function summarizeActionPlans(rows) {
  const countsByPlanId = {};
  const countsByIssueCode = {};
  for (const row of rows) {
    const planId = String(row?.actionPlan?.planId || "UNSET");
    const issueCode = String(row?.actionPlan?.issueCode || "unset");
    countsByPlanId[planId] = (countsByPlanId[planId] || 0) + 1;
    countsByIssueCode[issueCode] = (countsByIssueCode[issueCode] || 0) + 1;
  }
  return {
    countsByPlanId,
    countsByIssueCode,
  };
}

function toGate(summary) {
  const critical = Number(summary?.countsBySeverity?.critical || 0);
  const warning = Number(summary?.countsBySeverity?.warning || 0);
  if (critical > 0) return "blocked";
  if (warning > 0) return "review";
  return "safe";
}

function renderMatrixMarkdown(params) {
  const lines = [];
  lines.push("# Clerk Org Schema Plan Matrix");
  lines.push("");
  lines.push(`- Generated: ${params.createdAt}`);
  lines.push(`- Schema source: \`${params.schemaSource}\``);
  lines.push(`- Total organizations: **${params.summary.totalOrgs}**`);
  lines.push(`- Planned OK: **${params.summary.plannedOk}**`);
  lines.push(`- Missing instant credentials: **${params.summary.missingInstantCredentials}**`);
  lines.push(`- Blocked: **${params.summary.blocked}**`);
  lines.push(`- Account mismatch apps: **${params.summary.accountMismatchCount}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Safe: **${params.summary.safe}**`);
  lines.push(`- Review required: **${params.summary.reviewRequired}**`);
  lines.push(`- Total critical steps: **${params.summary.totalCritical}**`);
  lines.push(`- Total warning steps: **${params.summary.totalWarning}**`);
  lines.push(
    `- Account mismatch app IDs: ${
      params.summary.accountMismatchAppIds.length > 0
        ? params.summary.accountMismatchAppIds.map((value) => `\`${value}\``).join(", ")
        : "none"
    }`,
  );
  lines.push("");
  lines.push("## Per Org");
  lines.push("");
  lines.push("| Org | App | Plan | Gate | Steps | Critical | Warning | Error Kind | Error |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const row of params.rows) {
    const orgName = row.org?.name || row.org?.id || "unknown";
    const appValue = row.instant?.appId ? `\`${row.instant.appId}\`` : "missing";
    const planState = row.plan?.status || "skipped";
    const gate = row.plan?.gate || (row.instant?.hasAppId ? "review" : "missing-creds");
    const steps = Number(row.plan?.summary?.total || 0);
    const critical = Number(row.plan?.summary?.countsBySeverity?.critical || 0);
    const warning = Number(row.plan?.summary?.countsBySeverity?.warning || 0);
    const errorKind = row.plan?.status === "error" ? String(row.plan?.errorKind || "plan_error") : "";
    const error = row.plan?.status === "error" ? String(row.plan?.error || "").replace(/\|/g, "\\|").slice(0, 140) : "";
    lines.push(
      `| ${orgName} | ${appValue} | ${planState} | ${gate} | ${steps} | ${critical} | ${warning} | ${errorKind} | ${error} |`,
    );
  }
  if (params.accountMismatchApps.length > 0) {
    lines.push("");
    lines.push("## Apps con otra cuenta");
    lines.push("");
    lines.push("| App ID | Organization | Error |");
    lines.push("| --- | --- | --- |");
    for (const item of params.accountMismatchApps) {
      const appValue = `\`${String(item.appId || "").replace(/\|/g, "\\|")}\``;
      const orgValue = String(item.orgName || item.orgId || "unknown").replace(/\|/g, "\\|");
      const errorValue = String(item.error || "").replace(/\|/g, "\\|").slice(0, 220);
      lines.push(`| ${appValue} | ${orgValue} | ${errorValue} |`);
    }
  }
  lines.push("");
  lines.push("## Accionables por app");
  lines.push("");
  lines.push("| Org | App | Plan ID | Issue | Action |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of params.rows) {
    const orgName = String(row.org?.name || row.org?.id || "unknown").replace(/\|/g, "\\|");
    const appValue = row.instant?.appId ? `\`${String(row.instant.appId).replace(/\|/g, "\\|")}\`` : "missing";
    const planId = String(row.actionPlan?.planId || "UNSET").replace(/\|/g, "\\|");
    const issueCode = String(row.actionPlan?.issueCode || "unset").replace(/\|/g, "\\|");
    const action = String(row.actionPlan?.steps?.[0] || "").replace(/\|/g, "\\|").slice(0, 180);
    lines.push(`| ${orgName} | ${appValue} | ${planId} | ${issueCode} | ${action} |`);
  }
  lines.push("");
  lines.push("### Action Plan Counts");
  lines.push("");
  for (const [planId, count] of Object.entries(params.actionPlans.countsByPlanId)) {
    lines.push(`- ${planId}: **${count}**`);
  }
  lines.push("");
  lines.push("## Deployment Gate");
  lines.push("");
  lines.push("1. Block deployment for rows with `gate=blocked`.");
  lines.push("2. Require human sign-off for rows with `gate=review`.");
  lines.push("3. Only proceed when target rollout wave rows are `safe`.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const envName = arg("env", "production");
  const runId = arg("run-id", `run-${Date.now()}`);
  const orgIdForAudit = arg("org", "");
  const outFile = arg("out", ".\\artifacts\\reports\\schema-plan-org-matrix.json");
  const instructionsOut = arg("instructions-out", ".\\artifacts\\reports\\schema-plan-org-matrix.md");
  const schemaFile = resolveSchemaFileInput(
    arg("schema-file", ""),
    arg("repo", ""),
  );
  const clerkSecretKey = arg("clerk-secret", "");
  const instantApiUri = normalizeApiUri(arg("instant-api-uri", "https://api.instantdb.com"), "https://api.instantdb.com");
  const clerkApiUri = normalizeApiUri(arg("clerk-api-uri", "https://api.clerk.com"), "https://api.clerk.com");
  const orgFilter = new Set(splitList(arg("org-ids", "")).map((v) => v.trim()));
  const requireAllSafe = hasFlag("require-all-safe");
  const printOutput = hasFlag("print-output");
  const includeOutput = !hasFlag("strip-output");

  if (!schemaFile || !clerkSecretKey) {
    throw new Error(
      "Missing required input: resolvable schema file and --clerk-secret. " +
        "Provide --schema-file explicitly or ensure esolbay-platform/instant.schema.ts is available.",
    );
  }

  const resolvedSchema = await resolveSchema(schemaFile);
  await writeMigrationAudit({
    runId,
    script: "plan_schema_push_org_matrix",
    stage: "snapshot",
    orgId: orgIdForAudit,
    envName,
    payload: {
      schemaSource: resolvedSchema.schemaSource,
      schemaType: resolvedSchema.schemaType,
      outFile: path.resolve(outFile),
      instructionsOut: path.resolve(instructionsOut),
      orgFilterSize: orgFilter.size,
    },
  });

  const orgs = await listClerkOrganizations({
    clerkApiUri,
    clerkSecretKey,
    limit: 100,
  });

  const rows = [];
  for (const orgRow of orgs) {
    const orgId = String(orgRow?.id || "").trim();
    if (!orgId) continue;
    if (orgFilter.size > 0 && !orgFilter.has(orgId)) continue;

    const detail = await getClerkOrganization(clerkApiUri, clerkSecretKey, orgId);
    const instant = extractInstantCredentials(detail);
    const row = {
      org: {
        id: orgId,
        name: String(detail?.name || orgRow?.name || ""),
        slug: String(detail?.slug || orgRow?.slug || ""),
      },
      instant: {
        appId: instant.appId || null,
        hasAppId: Boolean(instant.appId),
        hasAdminToken: Boolean(instant.adminToken),
      },
      plan: null,
    };

    if (!instant.appId || !instant.adminToken) {
      row.plan = {
        status: "skipped",
        reason: "missing_instant_credentials",
        gate: "missing-creds",
      };
      row.actionPlan = buildActionPlan(row);
      rows.push(row);
      continue;
    }

    try {
      const planned = await planForApp({
        appId: instant.appId,
        adminToken: instant.adminToken,
        instantApiUri,
        schema: resolvedSchema.schema,
      });
      const gate = toGate(planned.summary);
      row.plan = {
        status: "ok",
        gate,
        endpoint: planned.endpoint,
        summary: planned.summary,
        instructions: planned.instructions,
        ...(includeOutput ? { output: planned.payload } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      row.plan = {
        status: "error",
        gate: "blocked",
        errorKind: inferPlanErrorKind(errorMessage),
        error: errorMessage,
      };
    }

    row.actionPlan = buildActionPlan(row);
    rows.push(row);
  }

  const summary = createMatrixSummary(rows);
  const accountMismatchApps = collectAccountMismatchApps(rows);
  const actionPlans = summarizeActionPlans(rows);
  const createdAt = new Date().toISOString();
  const report = {
    ok: true,
    envName,
    createdAt,
    instantApiUri,
    clerkApiUri,
    schemaSource: resolvedSchema.schemaSource,
    schemaType: resolvedSchema.schemaType,
    summary,
    accountMismatchApps,
    actionPlans,
    rows,
    meta: {
      envFilesLoaded: envLoad.loaded,
      envFilesFailed: envLoad.failed,
      envAliasesApplied: envLoad.aliases,
    },
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");

  const markdown = renderMatrixMarkdown({
    createdAt,
    schemaSource: resolvedSchema.schemaSource,
    summary,
    accountMismatchApps,
    actionPlans,
    rows,
  });
  await fs.mkdir(path.dirname(instructionsOut), { recursive: true });
  await fs.writeFile(instructionsOut, markdown, "utf8");

  await writeMigrationAudit({
    runId,
    script: "plan_schema_push_org_matrix",
    stage: "final",
    orgId: orgIdForAudit,
    envName,
    payload: {
      outFile: path.resolve(outFile),
      instructionsOut: path.resolve(instructionsOut),
      summary,
      requireAllSafe,
    },
  });

  if (requireAllSafe && (summary.blocked > 0 || summary.reviewRequired > 0)) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "require_all_safe_failed",
          summary,
          outFile: path.resolve(outFile),
          instructionsOut: path.resolve(instructionsOut),
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  if (printOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        outFile: path.resolve(outFile),
        instructionsOut: path.resolve(instructionsOut),
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
