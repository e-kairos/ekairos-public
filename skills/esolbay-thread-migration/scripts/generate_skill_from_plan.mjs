#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildMarkdown(params) {
  const lines = [];
  lines.push("---");
  lines.push(`name: ${params.skillName}`);
  lines.push(
    "description: Generate and execute a human-supervised migration from schema plan output, including env bootstrap from .env files, migration scripts, and verification gates.",
  );
  lines.push("---");
  lines.push("");
  lines.push(`# ${params.skillName}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- Source plan: \`${params.planFile}\``);
  lines.push(`- App ID: \`${params.appId || "unset"}\``);
  lines.push(`- Env: \`${params.envName || "production"}\``);
  lines.push(`- From version: \`${params.fromVersion || "unset"}\``);
  lines.push(`- To version: \`${params.toVersion || "unset"}\``);
  lines.push("");
  lines.push("## Workflow");
  lines.push("");
  lines.push("1. Load `.env*` under operator supervision.");
  lines.push("2. Run `plan_schema_push` and review generated instructions.");
  lines.push("3. Fill before/after contract for impacted entities.");
  lines.push("4. Generate extract/transform/apply/verify scripts.");
  lines.push("5. Run dry-run first, then apply with explicit human approval.");
  lines.push("6. Persist snapshot/final audit records per script.");
  lines.push("7. Validate build/tests and roll out by org waves.");
  lines.push("");
  lines.push("## Critical plan actions");
  lines.push("");
  if (params.critical.length === 0) {
    lines.push("- No critical steps detected in the current schema plan.");
  } else {
    for (const item of params.critical) {
      lines.push(`- [${item.severity}] \`${item.type}\`${item.target ? ` (${item.target})` : ""}`);
      lines.push(`  - ${item.action}`);
    }
  }
  lines.push("");
  lines.push("## Scripts");
  lines.push("");
  lines.push("- `scripts/plan_schema_push.mjs`");
  lines.push("- `scripts/extract_domain_dataset.mjs`");
  lines.push("- `scripts/transform_dataset.py` or generated `transform_dataset.ts`");
  lines.push("- `scripts/apply_instant_tx.mjs`");
  lines.push("- `scripts/verify_migration.mjs`");
  lines.push("- `scripts/_migration_audit.mjs`");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Human supervision is mandatory for any non-dry-run execution.");
  lines.push("- Canary rollout before full production rollout.");
  lines.push("- Keep rollback path and datasets for every migrated org.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const planFile = path.resolve(arg("plan-file", ".\\artifacts\\reports\\schema-plan.json"));
  const outFile = path.resolve(arg("out", ".\\artifacts\\reports\\generated-skill.md"));
  const fromVersion = arg("from", "");
  const toVersion = arg("to", "");
  const appId = arg("app-id", "");
  const envName = arg("env", "production");

  const rawPlan = (await fs.readFile(planFile, "utf8")).replace(/^\uFEFF/, "");
  const plan = JSON.parse(rawPlan);
  const instructions = Array.isArray(plan?.instructions) ? plan.instructions : [];
  const critical = instructions.filter((item) => item?.severity === "critical" || item?.severity === "warning");

  const fallbackName = `esolbay-${fromVersion || "from"}-to-${toVersion || "to"}-migration-skill`;
  const skillName = slugify(arg("skill-name", fallbackName));
  if (!skillName) {
    throw new Error("Unable to infer skill name. Pass --skill-name.");
  }

  const markdown = buildMarkdown({
    skillName,
    planFile,
    appId,
    envName,
    fromVersion,
    toVersion,
    critical,
  });

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile,
        skillName,
        criticalActions: critical.length,
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
