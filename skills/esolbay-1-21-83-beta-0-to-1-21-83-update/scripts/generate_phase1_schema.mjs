#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFiles } from "./_env.mjs";

const envLoad = loadEnvFiles();
const execFileAsync = promisify(execFile);

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function splitList(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
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

function collectRemovedLinksFromDiagnostics(diagnostics) {
  const out = new Set();
  const rows = Array.isArray(diagnostics?.diagnostics) ? diagnostics.diagnostics : [];
  for (const row of rows) {
    if (row?.issueCode !== "schema_duplicate_link") continue;
    if (!row?.sanitizedPlan?.ok) continue;
    const removed = Array.isArray(row?.sanitizedPlan?.removedLinks) ? row.sanitizedPlan.removedLinks : [];
    for (const name of removed) {
      const normalized = String(name || "").trim();
      if (normalized) out.add(normalized);
    }
  }
  return Array.from(out);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Phase 1 Transitional Schema");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Source schema: \`${report.sourceSchema}\``);
  lines.push(`- Removed link keys: ${report.removedLinks.map((item) => `\`${item}\``).join(", ")}`);
  lines.push(`- Missing link keys: ${report.missingLinks.length > 0 ? report.missingLinks.map((item) => `\`${item}\``).join(", ") : "none"}`);
  lines.push("");
  lines.push("## Rationale");
  lines.push("");
  lines.push("This transitional schema is intended for phase 1 of a two-phase rollout to clear legacy link identities before pushing the full target schema.");
  lines.push("");
  lines.push("## Next step");
  lines.push("");
  lines.push("Run matrix planning with this schema file, then proceed with phase 2 using the full schema.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const schemaFile = resolveSchemaFileInput(arg("schema-file", ""), arg("repo", ""));
  const diagnosticsFile = path.resolve(arg("diagnostics", ".\\artifacts\\reports\\schema-plan-diagnostics.json"));
  const outFile = path.resolve(arg("out", ".\\artifacts\\reports\\schema-phase1.json"));
  const outMd = path.resolve(arg("out-md", ".\\artifacts\\reports\\schema-phase1.md"));
  const extraRemovedLinks = splitList(arg("remove-links", ""));

  if (!schemaFile) {
    throw new Error("Missing required input: resolvable schema file.");
  }
  if (!fsSync.existsSync(diagnosticsFile)) {
    throw new Error(`Diagnostics file not found: ${diagnosticsFile}`);
  }

  const resolvedSchema = await resolveSchema(schemaFile);
  const diagnostics = JSON.parse(await fs.readFile(diagnosticsFile, "utf8"));
  const fromDiagnostics = collectRemovedLinksFromDiagnostics(diagnostics);
  const removeCandidates = Array.from(new Set([...fromDiagnostics, ...extraRemovedLinks]));

  if (removeCandidates.length === 0) {
    throw new Error(
      "No removable links found in diagnostics. " +
        "Run diagnose_plan_failures first or pass --remove-links explicitly.",
    );
  }

  const schema = JSON.parse(JSON.stringify(resolvedSchema.schema || {}));
  const links = schema && typeof schema.links === "object" && schema.links ? schema.links : null;
  if (!links) {
    throw new Error("Target schema has no `links` object.");
  }

  const removedLinks = [];
  const missingLinks = [];
  for (const linkName of removeCandidates) {
    if (Object.prototype.hasOwnProperty.call(links, linkName)) {
      delete links[linkName];
      removedLinks.push(linkName);
    } else {
      missingLinks.push(linkName);
    }
  }

  if (removedLinks.length === 0) {
    throw new Error(
      `No links removed from schema. Candidates: ${removeCandidates.join(", ")}`,
    );
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceSchema: resolvedSchema.schemaSource,
    schemaType: resolvedSchema.schemaType,
    diagnosticsFile,
    removeCandidates,
    removedLinks,
    missingLinks,
    schema,
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
        removedLinks,
        missingLinks,
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

