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

function normalizeApiUri(value) {
  const raw = String(value || "https://api.instantdb.com").trim();
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

function actionForStep(step) {
  const type = String(step?.type || "unknown");
  const target = identityFromStep(step);
  const targetText = target ? ` (${target})` : "";
  switch (type) {
    case "add-attr":
      return `No backfill is required by default${targetText}; add backfill if reads expect non-null values.`;
    case "update-attr":
      return `Generate a transform script for existing values${targetText} and verify old/new readers stay compatible.`;
    case "delete-attr":
      return `Take a snapshot before deletion${targetText}, remove code references, and keep rollback data.`;
    case "index":
      return `Track indexing background time${targetText} and verify query latency impact after rollout.`;
    case "remove-index":
      return `Review query paths${targetText} to avoid performance regressions before removing this index.`;
    case "unique":
      return `Run duplicate detection${targetText}, generate dedupe rules, and block apply until duplicates are resolved.`;
    case "remove-unique":
      return `Validate business constraints${targetText} that currently depend on uniqueness before relaxing them.`;
    case "required":
      return `Backfill missing values${targetText} before apply; fail migration if null/undefined values remain.`;
    case "remove-required":
      return `Update validations${targetText} and downstream assumptions to accept optional values.`;
    case "check-data-type":
      return `Run data type scan${targetText}, coerce invalid values in transform phase, and verify with post-checks.`;
    case "remove-data-type":
      return `Document why type constraints are removed${targetText} and keep runtime validators in app code.`;
    default:
      return "Review this step manually and define explicit migration + verification actions before apply.";
  }
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
    action: actionForStep(step),
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
    const parsed = JSON.parse(content);
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

function renderInstructionsMarkdown(plan) {
  const lines = [];
  lines.push("# Instant Schema Plan Instructions");
  lines.push("");
  lines.push("- Mode: human-supervised migration agent");
  lines.push(`- App ID: \`${plan.appId}\``);
  lines.push(`- Env: \`${plan.envName}\``);
  lines.push(`- Generated: ${plan.createdAt}`);
  lines.push(`- Schema source: \`${plan.schemaSource}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total steps: **${plan.summary.total}**`);
  lines.push(`- Critical: **${plan.summary.countsBySeverity.critical}**`);
  lines.push(`- Warning: **${plan.summary.countsBySeverity.warning}**`);
  lines.push(`- Review: **${plan.summary.countsBySeverity.review}**`);
  lines.push(`- Safe: **${plan.summary.countsBySeverity.safe}**`);
  lines.push("");
  lines.push("## Required Gates");
  lines.push("");
  lines.push("1. Keep human approval before any non-dry-run apply.");
  lines.push("2. Run extract -> transform -> dry-run tx -> verify before apply.");
  lines.push("3. Record snapshot/final audit entries for each migration script.");
  lines.push("4. Canary rollout by organization before broad rollout.");
  lines.push("");
  lines.push("## Agent Actions By Step");
  lines.push("");
  if (plan.instructions.length === 0) {
    lines.push("No schema steps detected.");
    return lines.join("\n");
  }
  for (const item of plan.instructions) {
    const target = item.target ? ` (${item.target})` : "";
    lines.push(`${item.index}. [${item.severity}] \`${item.type}\`${target}`);
    if (item.summary) {
      lines.push(`   - Plan: ${item.summary}`);
    }
    lines.push(`   - Action: ${item.action}`);
  }
  lines.push("");
  lines.push("## Next Commands");
  lines.push("");
  lines.push("```powershell");
  lines.push("# Review plan artifacts");
  lines.push("Get-Content .\\artifacts\\reports\\schema-plan.instructions.md");
  lines.push("# Continue migration flow");
  lines.push("node scripts/extract_domain_dataset.mjs --query-file .\\queries\\source.json --out .\\artifacts\\datasets\\source.json");
  lines.push("```");
  return lines.join("\n");
}

async function main() {
  const appId = arg("app-id", "");
  const envName = arg("env", "production");
  const token = arg("admin-token", "");
  const apiUri = normalizeApiUri(arg("api-uri", "https://api.instantdb.com"));
  const schemaFile = resolveSchemaFileInput(
    arg("schema-file", ""),
    arg("repo", ""),
  );
  const outFile = arg("out", ".\\artifacts\\reports\\schema-plan.json");
  const instructionsOut = arg("instructions-out", ".\\artifacts\\reports\\schema-plan.instructions.md");
  const runId = arg("run-id", `run-${Date.now()}`);
  const orgId = arg("org", "");
  const printOutput = hasFlag("print-output");

  if (!appId || !token || !schemaFile) {
    throw new Error(
      "Missing required input: --app-id, --admin-token, and resolvable schema file. " +
        "Provide --schema-file explicitly or ensure esolbay-platform/instant.schema.ts is available.",
    );
  }

  const resolvedSchema = await resolveSchema(schemaFile);
  await writeMigrationAudit({
    runId,
    script: "plan_schema_push",
    stage: "snapshot",
    orgId,
    envName,
    payload: {
      appId,
      apiUri,
      schemaSource: resolvedSchema.schemaSource,
      schemaType: resolvedSchema.schemaType,
      outFile: path.resolve(outFile),
      instructionsOut: path.resolve(instructionsOut),
    },
  });

  const endpoint = `${apiUri}/superadmin/apps/${encodeURIComponent(appId)}/schema/push/plan`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      schema: resolvedSchema.schema,
    }),
  });

  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }

  if (!response.ok) {
    throw new Error(`planSchemaPush failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const instructions = steps.map((step, index) => toInstruction(step, index));
  const summary = summarizeSteps(steps);

  const plan = {
    ok: true,
    appId,
    orgId,
    envName,
    apiUri,
    endpoint,
    createdAt: new Date().toISOString(),
    schemaSource: resolvedSchema.schemaSource,
    schemaType: resolvedSchema.schemaType,
    summary,
    instructions,
    payload,
    meta: {
      envFilesLoaded: envLoad.loaded,
      envFilesFailed: envLoad.failed,
      envAliasesApplied: envLoad.aliases,
    },
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(plan, null, 2), "utf8");

  const markdown = renderInstructionsMarkdown(plan);
  await fs.mkdir(path.dirname(instructionsOut), { recursive: true });
  await fs.writeFile(instructionsOut, markdown, "utf8");

  await writeMigrationAudit({
    runId,
    script: "plan_schema_push",
    stage: "final",
    orgId,
    envName,
    payload: {
      appId,
      endpoint,
      outFile: path.resolve(outFile),
      instructionsOut: path.resolve(instructionsOut),
      totalSteps: summary.total,
      criticalSteps: summary.countsBySeverity.critical,
      warningSteps: summary.countsBySeverity.warning,
    },
  });

  if (printOutput) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        appId,
        outFile: path.resolve(outFile),
        instructionsOut: path.resolve(instructionsOut),
        summary,
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
