#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadEnvFiles } from "./_env.mjs";
import { resolveInstantCredentialsFromClerk } from "./_clerk_instant.mjs";
import { updateRunManifest, writeRunArtifactJson } from "./_run_artifacts.mjs";
import { writeMigrationAudit } from "./_migration_audit.mjs";

const execFileAsync = promisify(execFile);
const envLoad = loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeApiUri(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/\/+$/, "");
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
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fsSync.existsSync(resolved)) return resolved;
  }
  return "";
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
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

async function loadSchema(schemaFile) {
  const resolved = path.resolve(schemaFile);
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".json") {
    const parsed = await readJson(resolved);
    return parsed && typeof parsed === "object" && parsed.schema && typeof parsed.schema === "object"
      ? parsed.schema
      : parsed;
  }
  if (ext === ".ts" || ext === ".mts" || ext === ".tsx") {
    return loadSchemaViaTsx(resolved);
  }
  throw new Error(`Unsupported schema file extension: ${ext}`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
    url,
  };
}

async function adminQuery(appId, adminToken, query, instantApiUri) {
  return fetchJson(`${instantApiUri}/admin/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "app-id": String(appId),
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ query }),
  });
}

async function pullSchema(appId, adminToken, instantApiUri) {
  return fetchJson(`${instantApiUri}/dash/apps/${encodeURIComponent(appId)}/schema/pull`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${adminToken}`,
      accept: "application/json",
    },
  });
}

async function pullPerms(appId, adminToken, instantApiUri) {
  const endpoints = [
    `${instantApiUri}/dash/apps/${encodeURIComponent(appId)}/perms/pull`,
    `${instantApiUri}/dash/apps/${encodeURIComponent(appId)}/permissions/pull`,
    `${instantApiUri}/superadmin/apps/${encodeURIComponent(appId)}/perms/pull`,
  ];
  const attempts = [];
  for (const endpoint of endpoints) {
    const result = await fetchJson(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${adminToken}`,
        accept: "application/json",
      },
    });
    attempts.push(result);
    if (result.ok) {
      return {
        ...result,
        attempts,
      };
    }
  }
  return {
    ok: false,
    status: attempts[attempts.length - 1]?.status || 0,
    payload: attempts[attempts.length - 1]?.payload || {},
    attempts,
  };
}

async function planSchemaPush(appId, adminToken, schema, instantApiUri) {
  return fetchJson(`${instantApiUri}/dash/apps/${encodeURIComponent(appId)}/schema/plan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      schema,
      check_types: true,
      supports_background_updates: true,
      supports_transactional_push: true,
    }),
  });
}

function classifyStep(step) {
  const type = String(step?.type || "unknown");
  const critical = new Set(["delete-attr", "update-attr", "unique", "required", "check-data-type"]);
  const warning = new Set(["remove-unique", "remove-required", "remove-index", "remove-data-type"]);
  if (critical.has(type)) return "critical";
  if (warning.has(type)) return "warning";
  return "safe";
}

function summarizePlanSteps(steps) {
  const out = {
    total: Array.isArray(steps) ? steps.length : 0,
    critical: 0,
    warning: 0,
    safe: 0,
  };
  for (const step of Array.isArray(steps) ? steps : []) {
    const level = classifyStep(step);
    out[level] += 1;
  }
  return out;
}

function toTxFromTransformed(transformed) {
  const warnings = [];
  const tx = [];
  const provided = Array.isArray(transformed?.tx) ? transformed.tx : [];

  if (provided.length > 0) {
    for (const op of provided) {
      const row = {
        op: String(op?.op || "").toLowerCase(),
        entity: String(op?.entity || "").trim(),
        id: String(op?.id || "").trim(),
        data: op?.data,
        links: op?.links,
      };
      if (!row.entity || !row.id || !row.op) {
        warnings.push("Skipped malformed tx row from transformed.tx");
        continue;
      }
      tx.push(row);
    }
  } else {
    for (const record of Array.isArray(transformed?.records) ? transformed.records : []) {
      const entity = String(record?.entity || "").trim();
      const id = String(record?.id || "").trim();
      if (!entity || !id) {
        warnings.push("Skipped malformed record row while creating tx");
        continue;
      }
      tx.push({
        op: String(record?.op || "update").toLowerCase(),
        entity,
        id,
        data: record?.data ?? {},
      });
    }

    for (const link of Array.isArray(transformed?.linkIntents) ? transformed.linkIntents : []) {
      const entity = String(link?.entity || "").trim();
      const id = String(link?.id || "").trim();
      if (!entity || !id) {
        warnings.push("Skipped malformed linkIntent row while creating tx");
        continue;
      }
      tx.push({
        op: "link",
        entity,
        id,
        links: link?.links ?? {},
      });
    }
  }

  const countsByOp = {};
  const countsByEntity = {};
  for (const row of tx) {
    countsByOp[row.op] = (countsByOp[row.op] || 0) + 1;
    countsByEntity[row.entity] = (countsByEntity[row.entity] || 0) + 1;
  }

  const destructiveOps = tx.filter((row) => row.op === "delete").length;

  return {
    tx,
    summary: {
      total: tx.length,
      destructiveOps,
      countsByOp,
      countsByEntity,
      warnings: warnings.length,
    },
    warnings,
  };
}

function countByEntity(payloadData) {
  const out = {};
  for (const [key, rows] of Object.entries(payloadData || {})) {
    out[key] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}

function parseJsonLoose(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(value.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stripOrderClauses(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripOrderClauses(item));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$" && item && typeof item === "object" && !Array.isArray(item)) {
      const nextDollar = {};
      for (const [dk, dv] of Object.entries(item)) {
        if (dk === "order") continue;
        nextDollar[dk] = stripOrderClauses(dv);
      }
      out[key] = nextDollar;
      continue;
    }
    out[key] = stripOrderClauses(item);
  }
  return out;
}

function sourceFailureIsNonBlocking(result) {
  if (!result || result.ok) return false;
  const status = Number(result.status || 0);
  if (status === 401 || status === 403) return false;
  const message = String(result?.payload?.message || "").toLowerCase();
  if (status === 400 && message.includes("validation failed for query")) return true;
  if (message.includes("does not exist") || message.includes("not indexed")) return true;
  return false;
}

async function runNode(scriptPath, args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 100,
    });
    return {
      ok: true,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || ""),
      error: String(error?.message || "command_failed"),
    };
  }
}

async function main() {
  const orgId = String(arg("org", "")).trim();
  if (!orgId) throw new Error("Missing required arg: --org");

  const scriptFile = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptFile);
  const skillRoot = path.resolve(scriptsDir, "..");
  const repoPath = resolveRepoPath(skillRoot);
  const schemaPath = resolveSchemaPath(repoPath, skillRoot);
  const sourceQueryFile = path.resolve(String(arg("source-query-file", path.join(skillRoot, "queries", "source.json"))));
  const verifyQueryFile = path.resolve(String(arg("verify-query-file", path.join(skillRoot, "queries", "verify.json"))));
  const clerkSecretKey = String(arg("clerk-secret", process.env.CLERK_SECRET_KEY || "")).trim();
  const clerkApiUri = normalizeApiUri(arg("clerk-api-uri", "https://api.clerk.com"), "https://api.clerk.com");
  const instantApiUri = normalizeApiUri(arg("instant-api-uri", "https://api.instantdb.com"), "https://api.instantdb.com");
  const runId = String(arg("run-id", `pre-migration-${Date.now()}`)).trim();
  const outFile = path.resolve(String(arg("out", path.join(skillRoot, "artifacts", "reports", `pre-migration-validation.${runId}.${orgId}.json`))));

  if (!repoPath) throw new Error("Failed to resolve esolbay-platform repo path. Pass --repo.");
  if (!schemaPath) throw new Error("Failed to resolve instant schema path.");
  if (!fsSync.existsSync(sourceQueryFile)) throw new Error(`Missing source query file: ${sourceQueryFile}`);
  if (!fsSync.existsSync(verifyQueryFile)) throw new Error(`Missing verify query file: ${verifyQueryFile}`);
  if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY.");

  const startedAt = nowIso();

  await writeMigrationAudit({
    runId,
    script: "validate_pre_migration_bundle",
    stage: "snapshot",
    orgId,
    envName: "production",
    payload: {
      repoPath,
      schemaPath,
      sourceQueryFile,
      verifyQueryFile,
      envFilesLoaded: envLoad.loaded,
      envFilesFailed: envLoad.failed,
      envAliasesApplied: envLoad.aliases,
    },
  });

  await updateRunManifest({
    runId,
    patch: {
      stages: {
        validation: {
          status: "running",
          startedAt,
          orgId,
          repoPath,
          schemaPath,
        },
      },
    },
  });

  const creds = await resolveInstantCredentialsFromClerk({
    orgId,
    clerkSecretKey,
    clerkApiUri,
  });
  const targetAppId = String(creds.appId || "").trim();
  const targetAdminToken = String(creds.adminToken || "").trim();

  const schema = await loadSchema(schemaPath);
  const sourceQuery = await readJson(sourceQueryFile);
  const verifyQuery = await readJson(verifyQueryFile);

  await writeRunArtifactJson({ runId, section: "01-extract", filename: "source.query.json", payload: sourceQuery });
  await writeRunArtifactJson({ runId, section: "04-verify", filename: "verify.query.json", payload: verifyQuery });
  await writeRunArtifactJson({ runId, section: "00-bootstrap", filename: "runtime.identity.json", payload: {
    orgId,
    targetAppId,
    targetAdminTokenPresent: Boolean(targetAdminToken),
    clerkApiUri,
    instantApiUri,
    startedAt,
  } });

  const schemaPull = await pullSchema(targetAppId, targetAdminToken, instantApiUri);
  const permsPull = await pullPerms(targetAppId, targetAdminToken, instantApiUri);
  const schemaPlan = await planSchemaPush(targetAppId, targetAdminToken, schema, instantApiUri);

  await writeRunArtifactJson({ runId, section: "01-extract", filename: "schema.pull.json", payload: schemaPull });
  await writeRunArtifactJson({ runId, section: "01-extract", filename: "perms.pull.json", payload: permsPull });
  await writeRunArtifactJson({ runId, section: "01-extract", filename: "schema.plan.before-push.json", payload: schemaPlan });

  let sourceQueryUsed = sourceQuery;
  let sourceResult = await adminQuery(targetAppId, targetAdminToken, sourceQueryUsed, instantApiUri);
  let sourceFallbackUsed = false;
  if (!sourceResult.ok) {
    const stripped = stripOrderClauses(sourceQuery);
    if (JSON.stringify(stripped) !== JSON.stringify(sourceQuery)) {
      const retry = await adminQuery(targetAppId, targetAdminToken, stripped, instantApiUri);
      sourceFallbackUsed = true;
      sourceQueryUsed = stripped;
      sourceResult = retry;
    }
  }
  const sourceNonBlocking = sourceFailureIsNonBlocking(sourceResult);
  await writeRunArtifactJson({ runId, section: "01-extract", filename: "source.query.used.json", payload: sourceQueryUsed });
  await writeRunArtifactJson({ runId, section: "01-extract", filename: "source.result.json", payload: sourceResult });
  await writeRunArtifactJson({
    runId,
    section: "01-extract",
    filename: "source.extract.meta.json",
    payload: {
      fallbackUsed: sourceFallbackUsed,
      nonBlockingFailure: sourceNonBlocking,
      ok: sourceResult.ok,
      status: sourceResult.status,
    },
  });

  const transformInputFile = path.join(skillRoot, "artifacts", "runs", runId, "02-transform", "source.for-transform.json");
  const transformOutputFile = path.join(skillRoot, "artifacts", "runs", runId, "02-transform", "story-thread-target.json");
  await fs.mkdir(path.dirname(transformInputFile), { recursive: true });
  await fs.writeFile(
    transformInputFile,
    JSON.stringify({ data: sourceResult.ok ? sourceResult.payload : {} }, null, 2),
    "utf8",
  );

  const transformCmd = await runNode(
    path.join(scriptsDir, "transform_story_to_thread_dataset.mjs"),
    ["--org", orgId, "--input", transformInputFile, "--output", transformOutputFile, "--run-id", runId],
    skillRoot,
  );
  await writeRunArtifactJson({ runId, section: "02-transform", filename: "transform.command.json", payload: transformCmd });

  const transformed = fsSync.existsSync(transformOutputFile)
    ? await readJson(transformOutputFile)
    : { records: [], linkIntents: [], warnings: ["transform output missing"] };

  const txPlan = toTxFromTransformed(transformed);
  await writeRunArtifactJson({ runId, section: "03-apply", filename: "tx.plan.json", payload: txPlan.tx });
  await writeRunArtifactJson({ runId, section: "03-apply", filename: "tx.plan.summary.json", payload: txPlan.summary });
  await writeRunArtifactJson({ runId, section: "03-apply", filename: "tx.plan.warnings.json", payload: txPlan.warnings });

  const transformedWithTxFile = path.join(skillRoot, "artifacts", "runs", runId, "03-apply", "transformed.with-tx.json");
  await fs.writeFile(
    transformedWithTxFile,
    JSON.stringify({ ...transformed, tx: txPlan.tx }, null, 2),
    "utf8",
  );

  const dryRunCmd = await runNode(
    path.join(scriptsDir, "apply_instant_tx.mjs"),
    [
      "--app-id",
      targetAppId,
      "--token",
      targetAdminToken,
      "--input",
      transformedWithTxFile,
      "--dry-run",
      "--org",
      orgId,
      "--run-id",
      runId,
    ],
    skillRoot,
  );
  const dryRunParsed = parseJsonLoose(dryRunCmd.stdout);
  await writeRunArtifactJson({ runId, section: "03-apply", filename: "tx.dry-run.command.json", payload: dryRunCmd });
  await writeRunArtifactJson({ runId, section: "03-apply", filename: "tx.dry-run.summary.json", payload: dryRunParsed || {} });

  const verifyBefore = await adminQuery(targetAppId, targetAdminToken, verifyQuery, instantApiUri);
  await writeRunArtifactJson({ runId, section: "04-verify", filename: "verify.before.json", payload: verifyBefore });

  const planSteps = Array.isArray(schemaPlan?.payload?.steps) ? schemaPlan.payload.steps : [];
  const planSummary = summarizePlanSteps(planSteps);

  const report = {
    ok: Boolean(schemaPull.ok) &&
      Boolean(permsPull.ok) &&
      Boolean(schemaPlan.ok) &&
      Boolean(transformCmd.ok) &&
      Boolean(dryRunCmd.ok) &&
      Boolean(verifyBefore.ok) &&
      (Boolean(sourceResult.ok) || sourceNonBlocking),
    runId,
    orgId,
    targetAppId,
    targetAdminTokenPresent: Boolean(targetAdminToken),
    startedAt,
    endedAt: nowIso(),
    validation: {
      schemaPull: { ok: schemaPull.ok, status: schemaPull.status },
      permsPull: { ok: permsPull.ok, status: permsPull.status },
      schemaPlan: { ok: schemaPlan.ok, status: schemaPlan.status, summary: planSummary },
      sourceExtract: {
        ok: sourceResult.ok,
        status: sourceResult.status,
        fallbackUsed: sourceFallbackUsed,
        nonBlockingFailure: sourceNonBlocking,
        entityCounts: countByEntity(sourceResult.payload),
      },
      transform: {
        ok: transformCmd.ok,
        records: Array.isArray(transformed?.records) ? transformed.records.length : 0,
        linkIntents: Array.isArray(transformed?.linkIntents) ? transformed.linkIntents.length : 0,
        warnings: Array.isArray(transformed?.warnings) ? transformed.warnings.length : 0,
      },
      txPlan: txPlan.summary,
      txDryRun: {
        ok: dryRunCmd.ok,
        parsed: dryRunParsed,
      },
      verifyBefore: {
        ok: verifyBefore.ok,
        status: verifyBefore.status,
        entityCounts: countByEntity(verifyBefore.payload),
      },
    },
    artifactsRoot: path.resolve(path.join(skillRoot, "artifacts", "runs", runId)),
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");

  await updateRunManifest({
    runId,
    patch: {
      stages: {
        validation: {
          status: report.ok ? "completed" : "failed",
          endedAt: report.endedAt,
          orgId,
          targetAppId,
          reportFile: outFile,
          summary: report.validation,
        },
      },
    },
  });

  await writeMigrationAudit({
    runId,
    script: "validate_pre_migration_bundle",
    stage: "final",
    orgId,
    envName: "production",
    payload: {
      ok: report.ok,
      reportFile: outFile,
      artifactsRoot: report.artifactsRoot,
      targetAppId,
    },
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
