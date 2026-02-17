#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseInlineJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

function globToRegex(fileGlob) {
  const escaped = fileGlob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

async function resolveFiles(globPattern) {
  const full = path.resolve(globPattern);
  if (!full.includes("*")) {
    return fsSync.existsSync(full) ? [full] : [];
  }
  const dir = path.dirname(full);
  const filePattern = path.basename(full);
  if (!fsSync.existsSync(dir)) return [];
  const rx = globToRegex(filePattern);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && rx.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function detectScenario(stepName, text) {
  const source = String(text || "").toLowerCase();
  if (source.includes("schema_duplicate_link")) return "schema_duplicate_link";
  if (source.includes("invalid admin token") || source.includes("invalid_admin_token")) return "invalid_admin_token";
  if (source.includes("instant app not found") || source.includes("instant_app_not_found")) return "instant_app_not_found";
  if (source.includes("not indexed") && source.includes("order")) return "verify_non_indexed_order";
  if (source.includes("validation failed for steps")) return "validation_failed_steps";
  return `generic_${String(stepName || "unknown").toLowerCase()}`;
}

function recommendedActionFor(scenario) {
  switch (scenario) {
    case "schema_duplicate_link":
      return "Run two-phase schema convergence: generate phase1 without new conflicting link, apply, re-plan final schema.";
    case "invalid_admin_token":
      return "Refresh appId/adminToken from Clerk org metadata and re-run planning gate.";
    case "instant_app_not_found":
      return "Mark org as account mismatch and exclude from rollout wave until ownership is fixed.";
    case "verify_non_indexed_order":
      return "Remove order clause for non-indexed attrs in verification query or index the attribute explicitly.";
    case "validation_failed_steps":
      return "Inspect tx plan for invalid link/attribute paths; regenerate transform output before apply.";
    default:
      return "Inspect step/artifact payload and create a deterministic remediation rule before retry.";
  }
}

function addOccurrence(registry, params) {
  const { scenario, signature, runId, stepName, source, evidence } = params;
  if (!registry[scenario]) {
    registry[scenario] = {
      scenario,
      count: 0,
      signature,
      stepName,
      source,
      recommendedAction: recommendedActionFor(scenario),
      runIds: [],
      samples: [],
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
  }
  const item = registry[scenario];
  item.count += 1;
  item.lastSeenAt = new Date().toISOString();
  if (runId && !item.runIds.includes(runId)) item.runIds.push(runId);
  if (evidence && item.samples.length < 3) item.samples.push(evidence);
}

function toMarkdown(summary) {
  const lines = [];
  lines.push("# Scenario Registry");
  lines.push("");
  lines.push("This file is generated from migration run reports.");
  lines.push("");
  lines.push("| Scenario | Count | Step | Recommended Action |");
  lines.push("| --- | ---: | --- | --- |");
  for (const row of summary.scenarios) {
    lines.push(`| \`${row.scenario}\` | ${row.count} | \`${row.stepName}\` | ${row.recommendedAction} |`);
  }
  lines.push("");
  for (const row of summary.scenarios) {
    lines.push(`## ${row.scenario}`);
    lines.push("");
    lines.push(`- Count: ${row.count}`);
    lines.push(`- Step: \`${row.stepName}\``);
    lines.push(`- Signature: \`${row.signature}\``);
    lines.push(`- Source: \`${row.source}\``);
    lines.push(`- Run IDs: ${row.runIds.map((id) => `\`${id}\``).join(", ") || "_none_"}`);
    lines.push(`- Action: ${row.recommendedAction}`);
    if (row.samples.length > 0) {
      lines.push("- Samples:");
      for (const sample of row.samples) {
        lines.push(`  - \`${normalize(sample).slice(0, 220)}\``);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const reportsGlob = String(arg("reports-glob", ".\\artifacts\\reports\\migration.temp-domain.*.json")).trim();
  const outFile = path.resolve(String(arg("out", ".\\artifacts\\reports\\scenario-registry.json")).trim());
  const outMd = path.resolve(String(arg("out-md", ".\\references\\scenario-registry.md")).trim());

  const files = await resolveFiles(reportsGlob);
  const registry = {};

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const report = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const runId = String(report?.runId || "").trim();
    const steps = report?.reportFromMigrationDomain?.migration_steps || [];
    const artifacts = report?.reportFromMigrationDomain?.migration_artifacts || [];

    for (const step of steps) {
      const status = String(step?.status || "").toLowerCase();
      if (status === "ok") continue;
      const detail = normalize(JSON.stringify(step?.detail || {}));
      const scenario = detectScenario(step?.name, detail);
      const signature = `${step?.name || "unknown"}|${scenario}|${detail.slice(0, 140)}`;
      addOccurrence(registry, {
        scenario,
        signature,
        runId,
        stepName: step?.name || "unknown",
        source: "migration_steps",
        evidence: detail,
      });
    }

    for (const artifact of artifacts) {
      const kind = String(artifact?.kind || "").toLowerCase();
      if (kind !== "warning") continue;
      const parsed = parseInlineJson(artifact?.inlineContent);
      const msg = normalize(parsed?.message || artifact?.inlineContent || "");
      const scenario = detectScenario(artifact?.stepName, msg);
      const signature = `${artifact?.stepName || "unknown"}|${scenario}|${msg.slice(0, 140)}`;
      addOccurrence(registry, {
        scenario,
        signature,
        runId,
        stepName: artifact?.stepName || "unknown",
        source: "migration_artifacts.warning",
        evidence: msg,
      });
    }
  }

  const scenarios = Object.values(registry).sort((a, b) => b.count - a.count || a.scenario.localeCompare(b.scenario));
  const summary = {
    generatedAt: new Date().toISOString(),
    reportsGlob,
    filesScanned: files.length,
    scenarios,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.mkdir(path.dirname(outMd), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, `${toMarkdown(summary)}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, filesScanned: files.length, scenarios: scenarios.length, outFile, outMd }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
