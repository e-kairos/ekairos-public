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
  return { appId, adminToken };
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

function parseDuplicateTarget(errorMessage) {
  const text = String(errorMessage || "");
  const match = text.match(/schema:\s*([A-Za-z0-9_$]+)->([A-Za-z0-9_$]+)/i);
  if (!match) return null;
  return {
    entity: match[1],
    label: match[2],
  };
}

function inferIssueCode(row) {
  const message = String(row?.plan?.error || "").toLowerCase();
  if (row?.plan?.status === "ok") return "plan_ok";
  if (message.includes("duplicate entry found for attribute")) return "schema_duplicate_link";
  if (message.includes("record not found: token")) return "invalid_admin_token";
  if (message.includes("record not found: app")) return "instant_app_not_found";
  return "unknown_plan_error";
}

async function fetchCurrentSchema(instantApiUri, appId, adminToken) {
  const endpoint = `${instantApiUri}/dash/apps/${encodeURIComponent(appId)}/schema/pull`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      authorization: `Bearer ${adminToken}`,
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
  return { ok: response.ok, status: response.status, endpoint, payload };
}

function normalizeIdentity(identity) {
  if (!Array.isArray(identity) || identity.length < 3) return null;
  return {
    id: String(identity[0] || ""),
    entity: String(identity[1] || ""),
    label: String(identity[2] || ""),
  };
}

function collectIdentityMatches(schemaPayload, entity, label) {
  const refs = schemaPayload?.schema?.refs;
  if (!refs || typeof refs !== "object") return [];

  const matches = [];
  for (const [refKey, ref] of Object.entries(refs)) {
    const forward = normalizeIdentity(ref?.["forward-identity"]);
    const reverse = normalizeIdentity(ref?.["reverse-identity"]);
    if (forward && forward.entity === entity && forward.label === label) {
      matches.push({
        refKey,
        side: "forward",
        identity: forward,
        counterpart: reverse,
      });
    }
    if (reverse && reverse.entity === entity && reverse.label === label) {
      matches.push({
        refKey,
        side: "reverse",
        identity: reverse,
        counterpart: forward,
      });
    }
  }
  return matches;
}

function removeLinkByForwardIdentity(schema, entity, label) {
  const cloned = JSON.parse(JSON.stringify(schema));
  const links = cloned?.links;
  if (!links || typeof links !== "object") {
    return { schema: cloned, removed: [] };
  }
  const removed = [];
  for (const [name, link] of Object.entries(links)) {
    if (!link || typeof link !== "object") continue;
    if (link?.forward?.on === entity && link?.forward?.label === label) {
      removed.push(name);
      delete links[name];
    }
  }
  return { schema: cloned, removed };
}

async function planSchemaPush(instantApiUri, appId, adminToken, schema) {
  const endpoint = `${instantApiUri}/superadmin/apps/${encodeURIComponent(appId)}/schema/push/plan`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ schema }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  return { ok: response.ok, status: response.status, endpoint, payload };
}

function buildActions(issueCode, duplicateTarget) {
  if (issueCode === "invalid_admin_token") {
    return [
      "Rotate/regenerate admin token in Instant dashboard.",
      "Update Clerk privateMetadata.instant.adminToken for this org.",
      "Rerun planning for this org/app.",
    ];
  }
  if (issueCode === "schema_duplicate_link") {
    const target = duplicateTarget ? `${duplicateTarget.entity}->${duplicateTarget.label}` : "target link";
    return [
      `Inspect duplicated link identity ${target} and identify current-owner link in pulled schema.`,
      "Apply two-phase schema push when old and new links reuse the same label on the same entity.",
      "Rerun org matrix planning and confirm blocked count drops.",
    ];
  }
  if (issueCode === "instant_app_not_found") {
    return [
      "Validate Clerk privateMetadata.instant.appId is current.",
      "Fix app mapping in Clerk metadata.",
      "Rerun planning for this org.",
    ];
  }
  return [
    "Inspect row error details.",
    "Apply targeted fix for this org/app.",
    "Rerun planning.",
  ];
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Schema Plan Failure Diagnostics");
  lines.push("");
  lines.push(`- Generated: ${report.createdAt}`);
  lines.push(`- Total failures analyzed: **${report.summary.totalFailures}**`);
  lines.push(`- Distinct issue codes: **${Object.keys(report.summary.countByIssue).length}**`);
  lines.push("");
  lines.push("## Issue Summary");
  lines.push("");
  for (const [issue, count] of Object.entries(report.summary.countByIssue)) {
    lines.push(`- ${issue}: **${count}**`);
  }
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  lines.push("| Org | App | Issue | Current Identity Matches | Sanitized Plan | Action |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const row of report.diagnostics) {
    const org = String(row.org?.name || row.org?.id || "unknown").replace(/\|/g, "\\|");
    const app = row.appId ? `\`${String(row.appId).replace(/\|/g, "\\|")}\`` : "missing";
    const issue = String(row.issueCode || "unknown").replace(/\|/g, "\\|");
    const refCount = Number(row.currentSchema?.identityMatchCount || 0);
    const sanitized = row.sanitizedPlan
      ? row.sanitizedPlan.ok
        ? "ok"
        : `failed (${row.sanitizedPlan.status})`
      : "n/a";
    const action = String((row.actions || [])[0] || "").replace(/\|/g, "\\|").slice(0, 180);
    lines.push(`| ${org} | ${app} | ${issue} | ${refCount} | ${sanitized} | ${action} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const runId = arg("run-id", `run-${Date.now()}`);
  const envName = arg("env", "production");
  const orgIdForAudit = arg("org", "");
  const matrixFile = path.resolve(arg("matrix", ".\\artifacts\\reports\\schema-plan-org-matrix.json"));
  const outFile = path.resolve(arg("out", ".\\artifacts\\reports\\schema-plan-diagnostics.json"));
  const outMd = path.resolve(arg("out-md", ".\\artifacts\\reports\\schema-plan-diagnostics.md"));
  const schemaFile = resolveSchemaFileInput(
    arg("schema-file", ""),
    arg("repo", ""),
  );
  const clerkSecretKey = String(arg("clerk-secret", process.env.CLERK_SECRET_KEY || "")).trim();
  const instantApiUri = normalizeApiUri(arg("instant-api-uri", "https://api.instantdb.com"), "https://api.instantdb.com");
  const clerkApiUri = normalizeApiUri(arg("clerk-api-uri", "https://api.clerk.com"), "https://api.clerk.com");
  const printOutput = hasFlag("print-output");

  if (!clerkSecretKey) {
    throw new Error("Missing required input: --clerk-secret (or CLERK_SECRET_KEY).");
  }
  if (!schemaFile) {
    throw new Error(
      "Missing required input: resolvable schema file. " +
        "Provide --schema-file explicitly or ensure esolbay-platform/instant.schema.ts is available.",
    );
  }
  if (!fsSync.existsSync(matrixFile)) {
    throw new Error(`Matrix file not found: ${matrixFile}`);
  }

  const matrix = JSON.parse(await fs.readFile(matrixFile, "utf8"));
  const sourceRows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  const failedRows = sourceRows.filter((row) => row?.plan?.status === "error");
  const resolvedSchema = await resolveSchema(schemaFile);

  await writeMigrationAudit({
    runId,
    script: "diagnose_plan_failures",
    stage: "snapshot",
    orgId: orgIdForAudit,
    envName,
    payload: {
      matrixFile,
      schemaSource: resolvedSchema.schemaSource,
      schemaType: resolvedSchema.schemaType,
      failedRows: failedRows.length,
      outFile,
      outMd,
    },
  });

  const diagnostics = [];
  for (const row of failedRows) {
    const orgId = String(row?.org?.id || "").trim();
    const orgName = String(row?.org?.name || "");
    const issueCode = inferIssueCode(row);
    const errorText = String(row?.plan?.error || "");
    const duplicateTarget = parseDuplicateTarget(errorText);
    const item = {
      org: { id: orgId, name: orgName },
      appId: String(row?.instant?.appId || ""),
      issueCode,
      duplicateTarget,
      planError: errorText,
      currentSchema: null,
      sanitizedPlan: null,
      actions: buildActions(issueCode, duplicateTarget),
    };

    try {
      const orgPayload = await getClerkOrganization(clerkApiUri, clerkSecretKey, orgId);
      const instantCreds = extractInstantCredentials(orgPayload);
      item.appId = item.appId || instantCreds.appId;
      const adminToken = instantCreds.adminToken;

      if (!item.appId || !adminToken) {
        item.issueCode = "missing_instant_credentials";
        item.actions = [
          "Populate Clerk privateMetadata.instant.appId and privateMetadata.instant.adminToken.",
          "Rerun planning for this org.",
        ];
        diagnostics.push(item);
        continue;
      }

      const currentSchema = await fetchCurrentSchema(instantApiUri, item.appId, adminToken);
      const identityMatches =
        duplicateTarget && currentSchema.ok
          ? collectIdentityMatches(currentSchema.payload, duplicateTarget.entity, duplicateTarget.label)
          : [];
      item.currentSchema = {
        ok: currentSchema.ok,
        status: currentSchema.status,
        identityMatchCount: identityMatches.length,
        identityMatches: identityMatches.map((match) => ({
          side: match.side,
          owner: match.identity,
          counterpart: match.counterpart,
        })),
      };

      if (issueCode === "schema_duplicate_link" && duplicateTarget) {
        const sanitized = removeLinkByForwardIdentity(
          resolvedSchema.schema,
          duplicateTarget.entity,
          duplicateTarget.label,
        );
        if (sanitized.removed.length > 0) {
          const sanitizedPlan = await planSchemaPush(
            instantApiUri,
            item.appId,
            adminToken,
            sanitized.schema,
          );
          item.sanitizedPlan = {
            ok: sanitizedPlan.ok,
            status: sanitizedPlan.status,
            removedLinks: sanitized.removed,
          };
          if (sanitizedPlan.ok) {
            const conflictTargets = identityMatches
              .map((match) => {
                const counterpartEntity = String(match.counterpart?.entity || "");
                const counterpartLabel = String(match.counterpart?.label || "");
                return counterpartEntity && counterpartLabel
                  ? `${counterpartEntity}->${counterpartLabel}`
                  : counterpartEntity || counterpartLabel || null;
              })
              .filter(Boolean);
            const uniqueConflictTargets = Array.from(new Set(conflictTargets));
            item.actions = [
              `Phase 1 plan: push schema without new link(s) ${sanitized.removed.join(", ")} to clear legacy identity ${duplicateTarget.entity}->${duplicateTarget.label}.`,
              uniqueConflictTargets.length > 0
                ? `Legacy owner(s) detected in app schema: ${uniqueConflictTargets.join(", ")}.`
                : "Legacy owner not resolved from pull payload; inspect app refs in Instant dashboard.",
              "Phase 2 plan: push full target schema and rerun org matrix to confirm all apps pass planning.",
            ];
            item.resolutionPlan = {
              strategy: "two_phase_schema_push",
              phase1: {
                description:
                  "Push schema without the new conflicting link to remove old link identity from app schema.",
                removedLinks: sanitized.removed,
                planStatus: sanitizedPlan.status,
              },
              phase2: {
                description: "After phase 1 apply, rerun planning with full target schema.",
              },
            };
          }
        }
      }
    } catch (error) {
      item.diagnosticError = String(error?.message || error);
    }
    diagnostics.push(item);
  }

  const countByIssue = {};
  for (const item of diagnostics) {
    countByIssue[item.issueCode] = (countByIssue[item.issueCode] || 0) + 1;
  }

  const report = {
    ok: true,
    createdAt: new Date().toISOString(),
    matrixFile,
    schemaSource: resolvedSchema.schemaSource,
    schemaType: resolvedSchema.schemaType,
    summary: {
      totalFailures: diagnostics.length,
      countByIssue,
    },
    diagnostics,
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

  await writeMigrationAudit({
    runId,
    script: "diagnose_plan_failures",
    stage: "final",
    orgId: orgIdForAudit,
    envName,
    payload: {
      outFile,
      outMd,
      summary: report.summary,
    },
  });

  if (printOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

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
