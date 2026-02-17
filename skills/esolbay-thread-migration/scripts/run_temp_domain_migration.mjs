#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadEnvFiles } from "./_env.mjs";
import { resolveInstantCredentialsFromClerk } from "./_clerk_instant.mjs";

const execFileAsync = promisify(execFile);
loadEnvFiles();

const INSTANT_API = "https://api.instantdb.com";
const INLINE_LIMIT = 12_000;
const CHUNK_SIZE = 12_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function asString(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

function toJsonText(payload) {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload ?? null, null, 2);
}

function splitChunks(text, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function loadSchemaViaTsx(schemaPath) {
  const tmpScript = path.join(
    path.dirname(schemaPath),
    `.tmp-load-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  const loaderCode = [
    'import { pathToFileURL } from "node:url";',
    "const target = process.argv[2];",
    "const mod = await import(pathToFileURL(target).href);",
    "let schema = mod.default ?? mod.schema ?? mod.appSchema ?? mod.instantSchema ?? mod;",
    'if (schema && typeof schema === "object" && "default" in schema) schema = schema.default;',
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
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 50,
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
    return parsed?.schema && typeof parsed.schema === "object" ? parsed.schema : parsed;
  }
  if (ext === ".ts" || ext === ".mts" || ext === ".tsx") {
    try {
      const mod = await import(pathToFileURL(resolved).href);
      let schema = mod.default ?? mod.schema ?? mod.appSchema ?? mod.instantSchema ?? mod;
      if (schema && typeof schema === "object" && "default" in schema) {
        schema = schema.default;
      }
      return JSON.parse(JSON.stringify(schema));
    } catch {
      return loadSchemaViaTsx(resolved);
    }
  }
  throw new Error(`Unsupported schema file extension: ${ext}`);
}

async function adminTransact(appId, adminToken, steps) {
  const response = await fetch(`${INSTANT_API}/admin/transact`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "app-id": String(appId),
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ steps }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`admin/transact failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function adminQuery(appId, adminToken, query) {
  const response = await fetch(`${INSTANT_API}/admin/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "app-id": String(appId),
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`admin/query failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createTemporaryApp(title) {
  const response = await fetch(`${INSTANT_API}/dash/apps/ephemeral`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`create temporary app failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  const app = payload?.app || {};
  const appId = String(app.id || "").trim();
  const adminToken = String(app["admin-token"] || app.adminToken || "").trim();
  if (!appId || !adminToken) {
    throw new Error("Temporary app did not return appId/adminToken.");
  }
  return {
    appId,
    adminToken,
    payload,
  };
}

async function pullSchema(appId, adminToken) {
  const response = await fetch(`${INSTANT_API}/dash/apps/${encodeURIComponent(appId)}/schema/pull`, {
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
  return { ok: response.ok, status: response.status, payload };
}

async function pullPerms(appId, adminToken) {
  const endpoints = [
    `${INSTANT_API}/dash/apps/${encodeURIComponent(appId)}/perms/pull`,
    `${INSTANT_API}/dash/apps/${encodeURIComponent(appId)}/permissions/pull`,
    `${INSTANT_API}/superadmin/apps/${encodeURIComponent(appId)}/perms/pull`,
  ];
  const attempts = [];
  for (const endpoint of endpoints) {
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
    const attempt = {
      endpoint,
      ok: response.ok,
      status: response.status,
      payload,
    };
    attempts.push(attempt);
    if (response.ok) return { ok: true, status: response.status, payload, attempts };
  }
  return {
    ok: false,
    status: attempts[attempts.length - 1]?.status || 0,
    payload: attempts[attempts.length - 1]?.payload || {},
    attempts,
  };
}

async function planSchemaPush(appId, adminToken, schema) {
  const response = await fetch(`${INSTANT_API}/superadmin/apps/${encodeURIComponent(appId)}/schema/push/plan`, {
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
  return { ok: response.ok, status: response.status, payload };
}

function areJobsTerminal(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return true;
  return jobs.every((job) => {
    const status = String(job?.job_status || "");
    return status === "completed" || status === "errored";
  });
}

function hasErroredJobs(jobs) {
  return Array.isArray(jobs) && jobs.some((job) => String(job?.job_status || "") === "errored");
}

async function waitForIndexingJobs(appId, adminToken, groupId, initialJobs = []) {
  let jobs = Array.isArray(initialJobs) ? initialJobs : [];
  if (!groupId) {
    return {
      ok: true,
      groupId: "",
      jobs,
      polls: 0,
      timeout: false,
      erroredJobs: hasErroredJobs(jobs),
    };
  }

  const maxPolls = 90;
  const pollMs = 1000;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (areJobsTerminal(jobs)) {
      return {
        ok: !hasErroredJobs(jobs),
        groupId,
        jobs,
        polls: poll,
        timeout: false,
        erroredJobs: hasErroredJobs(jobs),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const response = await fetch(
      `${INSTANT_API}/dash/apps/${encodeURIComponent(appId)}/indexing-jobs/group/${encodeURIComponent(groupId)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${adminToken}`,
          accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        groupId,
        jobs,
        polls: poll + 1,
        timeout: false,
        erroredJobs: hasErroredJobs(jobs),
        fetchError: {
          status: response.status,
          body: text,
        },
      };
    }
    const payload = await response.json();
    jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  }

  return {
    ok: false,
    groupId,
    jobs,
    polls: maxPolls,
    timeout: true,
    erroredJobs: hasErroredJobs(jobs),
  };
}

async function applySchemaPush(appId, adminToken, schema) {
  const response = await fetch(`${INSTANT_API}/superadmin/apps/${encodeURIComponent(appId)}/schema/push/apply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      schema,
      check_types: true,
      supports_background_updates: true,
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
    return { ok: false, status: response.status, payload };
  }
  const groupId = String(payload?.["indexing-jobs"]?.["group-id"] || "").trim();
  const initialJobs = Array.isArray(payload?.["indexing-jobs"]?.jobs) ? payload["indexing-jobs"].jobs : [];
  const indexing = await waitForIndexingJobs(appId, adminToken, groupId, initialJobs);
  return {
    ok: indexing.ok,
    status: response.status,
    payload,
    indexing,
  };
}

async function runCommand(file, args, cwd) {
  const startedAt = nowIso();
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 100,
    });
    return {
      ok: true,
      startedAt,
      endedAt: nowIso(),
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
      exitCode: 0,
    };
  } catch (error) {
    return {
      ok: false,
      startedAt,
      endedAt: nowIso(),
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || ""),
      exitCode: Number(error?.code || 1),
      error: String(error?.message || "command_failed"),
    };
  }
}

async function storeEntity(migrationAppId, migrationAdminToken, entity, data, forcedId = "") {
  const id = forcedId && isUuid(forcedId) ? forcedId : uuid();
  await adminTransact(migrationAppId, migrationAdminToken, [["update", entity, id, data]]);
  return id;
}

async function storeArtifact(ctx, stepName, kind, label, payload, contentType = "application/json") {
  const text = toJsonText(payload);
  const digest = sha256(text);
  const artifactId = uuid();
  const chunks = text.length > INLINE_LIMIT ? splitChunks(text) : [];
  const inlineContent = chunks.length === 0 ? text : "";

  await storeEntity(ctx.migrationAppId, ctx.migrationAdminToken, "migration_artifacts", {
    runId: ctx.runId,
    stepName,
    kind,
    label,
    contentType,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    sha256: digest,
    chunked: chunks.length > 0,
    inlineContent,
    createdAt: nowIso(),
  }, artifactId);

  if (chunks.length > 0) {
    const steps = [];
    for (let i = 0; i < chunks.length; i += 1) {
      steps.push([
        "update",
        "migration_payload_chunks",
        uuid(),
        {
          artifactId,
          runId: ctx.runId,
          chunkIndex: i,
          content: chunks[i],
          createdAt: nowIso(),
        },
      ]);
    }
    const batchSize = 100;
    for (let i = 0; i < steps.length; i += batchSize) {
      await adminTransact(ctx.migrationAppId, ctx.migrationAdminToken, steps.slice(i, i + batchSize));
    }
  }

  return {
    artifactId,
    sha256: digest,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    chunked: chunks.length > 0,
    chunks: chunks.length,
  };
}

async function markStep(ctx, name, status, detail, startedAt = null) {
  return storeEntity(ctx.migrationAppId, ctx.migrationAdminToken, "migration_steps", {
    runId: ctx.runId,
    name,
    status,
    startedAt: startedAt || nowIso(),
    endedAt: nowIso(),
    detail: detail || {},
  });
}

function toStepValueId(value) {
  const raw = String(value || "").trim();
  if (isUuid(raw)) return raw;
  return "";
}

function sanitizeLinks(rawLinks) {
  const out = {};
  for (const [label, value] of Object.entries(rawLinks || {})) {
    if (!label) continue;
    if (Array.isArray(value)) {
      const ids = value.map(toStepValueId).filter(Boolean);
      if (ids.length > 0) out[label] = ids;
      continue;
    }
    const id = toStepValueId(value?.id ?? value);
    if (id) out[label] = id;
  }
  return out;
}

function transformedToSteps(transformed) {
  const warnings = [];
  const steps = [];
  const tx = Array.isArray(transformed?.tx) ? transformed.tx : [];
  const records = Array.isArray(transformed?.records) ? transformed.records : [];
  const linkIntents = Array.isArray(transformed?.linkIntents) ? transformed.linkIntents : [];

  if (tx.length > 0) {
    for (const item of tx) {
      const op = String(item?.op || "").toLowerCase();
      const entity = String(item?.entity || "").trim();
      const id = toStepValueId(item?.id);
      if (!entity || !id) {
        warnings.push(`Skipped tx op due to missing/invalid entity/id (${op})`);
        continue;
      }
      if (op === "upsert" || op === "update" || op === "create") {
        steps.push(["update", entity, id, item?.data ?? {}]);
        continue;
      }
      if (op === "delete") {
        steps.push(["delete", entity, id, null]);
        continue;
      }
      if (op === "link") {
        const links = sanitizeLinks(item?.links ?? item?.data ?? {});
        if (Object.keys(links).length === 0) {
          warnings.push(`Skipped empty link op for ${entity}.${id}`);
          continue;
        }
        steps.push(["link", entity, id, links]);
        continue;
      }
      if (op === "unlink") {
        const links = sanitizeLinks(item?.links ?? item?.data ?? {});
        if (Object.keys(links).length === 0) {
          warnings.push(`Skipped empty unlink op for ${entity}.${id}`);
          continue;
        }
        steps.push(["unlink", entity, id, links]);
        continue;
      }
      warnings.push(`Unsupported tx op: ${op || "unknown"}`);
    }
    return { steps, warnings, source: "transformed.tx" };
  }

  for (const record of records) {
    const entity = String(record?.entity || "").trim();
    const id = toStepValueId(record?.id);
    const op = String(record?.op || "upsert").toLowerCase();
    if (!entity || !id) {
      warnings.push("Skipped record due to missing/invalid entity/id");
      continue;
    }
    if (op === "delete") {
      steps.push(["delete", entity, id, null]);
      continue;
    }
    steps.push(["update", entity, id, record?.data ?? {}]);
  }

  for (const link of linkIntents) {
    const entity = String(link?.entity || "").trim();
    const id = toStepValueId(link?.id);
    if (!entity || !id) {
      warnings.push("Skipped link intent due to missing/invalid entity/id");
      continue;
    }
    const links = sanitizeLinks(link?.links ?? {});
    if (Object.keys(links).length === 0) continue;
    steps.push(["link", entity, id, links]);
  }

  return { steps, warnings, source: "records+linkIntents" };
}

async function applyStepsBatched(appId, adminToken, steps, batchSize = 200) {
  const results = [];
  for (let i = 0; i < steps.length; i += batchSize) {
    const batch = steps.slice(i, i + batchSize);
    const result = await adminTransact(appId, adminToken, batch);
    results.push({
      from: i,
      to: i + batch.length - 1,
      size: batch.length,
      result,
    });
  }
  return results;
}

function countByEntity(payload) {
  const out = {};
  for (const [key, rows] of Object.entries(payload || {})) {
    out[key] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
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

async function main() {
  const orgId = String(arg("org", "")).trim();
  if (!orgId) throw new Error("Missing required arg: --org");

  const scriptFile = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptFile);
  const skillRoot = path.resolve(scriptsDir, "..");
  const repoPath = path.resolve(
    String(arg("repo", path.resolve(skillRoot, "..", "..", "..", "esolbay-platform"))),
  );
  const schemaFile = path.resolve(String(arg("schema-file", path.join(repoPath, "instant.schema.ts"))));
  const sourceQueryFile = path.resolve(String(arg("source-query-file", path.join(skillRoot, "queries", "source.json"))));
  const verifyQueryFile = path.resolve(String(arg("verify-query-file", path.join(skillRoot, "queries", "verify.json"))));
  const clerkSecretKey = String(arg("clerk-secret", process.env.CLERK_SECRET_KEY || "")).trim();
  const clerkApiUri = String(arg("clerk-api-uri", "https://api.clerk.com")).trim();
  const runId = String(arg("run-id", `migration-${Date.now()}`)).trim();
  const dryRun = hasFlag("dry-run");

  if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY.");
  if (!fsSync.existsSync(repoPath)) throw new Error(`Repo not found: ${repoPath}`);
  if (!fsSync.existsSync(schemaFile)) throw new Error(`Schema file not found: ${schemaFile}`);
  if (!fsSync.existsSync(sourceQueryFile)) throw new Error(`Source query file not found: ${sourceQueryFile}`);
  if (!fsSync.existsSync(verifyQueryFile)) throw new Error(`Verify query file not found: ${verifyQueryFile}`);

  const target = await resolveInstantCredentialsFromClerk({
    orgId,
    clerkSecretKey,
    clerkApiUri,
  });
  const targetAppId = String(target.appId || "").trim();
  const targetAdminToken = String(target.adminToken || "").trim();

  const tmpTitle = `ekairos-migration-${orgId}-${Date.now()}`;
  const temporaryApp = await createTemporaryApp(tmpTitle);
  const migrationAppId = temporaryApp.appId;
  const migrationAdminToken = temporaryApp.adminToken;

  const ctx = {
    runId,
    orgId,
    targetAppId,
    targetAdminToken,
    migrationAppId,
    migrationAdminToken,
  };

  const runEntityId = await storeEntity(migrationAppId, migrationAdminToken, "migration_runs", {
    orgId,
    status: "running",
    startedAt: nowIso(),
    targetAppId,
    targetAdminToken,
    migrationAppId,
    migrationAdminToken,
    summary: {
      dryRun,
      repoPath,
      schemaFile,
      sourceQueryFile,
      verifyQueryFile,
    },
  });

  const sourceQuery = await readJson(sourceQueryFile);
  const verifyQuery = await readJson(verifyQueryFile);
  const targetSchema = await loadSchema(schemaFile);

  const sourceDataStarted = nowIso();
  let sourceData = {};
  try {
    sourceData = await adminQuery(targetAppId, targetAdminToken, sourceQuery);
    await markStep(ctx, "source_query", "ok", { entityCounts: countByEntity(sourceData) }, sourceDataStarted);
  } catch (error) {
    sourceData = {
      __error: String(error?.message || error),
    };
    await markStep(ctx, "source_query", "error", sourceData, sourceDataStarted);
  }
  await storeArtifact(ctx, "source_query", "query", "source.query", sourceQuery);
  await storeArtifact(ctx, "source_query", "query_result", "source.result", sourceData);

  const schemaPullStarted = nowIso();
  const schemaBefore = await pullSchema(targetAppId, targetAdminToken);
  const permsBefore = await pullPerms(targetAppId, targetAdminToken);
  await markStep(ctx, "snapshot_before", "ok", {
    schemaStatus: schemaBefore.status,
    permsStatus: permsBefore.status,
  }, schemaPullStarted);
  await storeArtifact(ctx, "snapshot_before", "schema_pull", "schema.before", schemaBefore);
  await storeArtifact(ctx, "snapshot_before", "perms_pull", "perms.before", permsBefore);

  const prePlanStarted = nowIso();
  const plannedBefore = await planSchemaPush(targetAppId, targetAdminToken, targetSchema);
  await storeArtifact(
    ctx,
    "schema_plan_before_push",
    "schema_plan",
    "schema.plan.before-push",
    plannedBefore,
  );
  await markStep(ctx, "schema_plan_before_push", plannedBefore.ok ? "ok" : "error", {
    status: plannedBefore.status,
    steps: Array.isArray(plannedBefore?.payload?.steps) ? plannedBefore.payload.steps.length : null,
  }, prePlanStarted);
  if (!plannedBefore.ok) {
    await storeEntity(migrationAppId, migrationAdminToken, "migration_reports", {
      runId,
      status: "failed",
      report: {
        reason: "plan_failed_before_push",
        plan: plannedBefore,
      },
      createdAt: nowIso(),
    });
    await storeEntity(migrationAppId, migrationAdminToken, "migration_runs", {
      orgId,
      status: "failed",
      endedAt: nowIso(),
      summary: {
        reason: "plan_failed_before_push",
        planStatus: plannedBefore.status,
      },
    }, runEntityId);
    throw new Error(`Plan failed before push (${plannedBefore.status}).`);
  }

  const pushStarted = nowIso();
  const pushResult = await applySchemaPush(targetAppId, targetAdminToken, targetSchema);
  await storeArtifact(
    ctx,
    "schema_push",
    "api_result",
    "platform-api.schema-push",
    pushResult,
    "application/json",
  );
  await markStep(ctx, "schema_push", pushResult.ok ? "ok" : "error", {
    status: pushResult.status,
    ok: pushResult.ok,
    indexingGroupId: pushResult?.indexing?.groupId || "",
    indexingTimeout: Boolean(pushResult?.indexing?.timeout),
    indexingErroredJobs: Boolean(pushResult?.indexing?.erroredJobs),
  }, pushStarted);
  if (!pushResult.ok) {
    console.error(JSON.stringify({ schemaPushFailure: pushResult }, null, 2));
    await storeEntity(migrationAppId, migrationAdminToken, "migration_reports", {
      runId,
      status: "failed",
      report: {
        reason: "schema_push_failed",
        pushResult,
      },
      createdAt: nowIso(),
    });
    await storeEntity(migrationAppId, migrationAdminToken, "migration_runs", {
      orgId,
      status: "failed",
      endedAt: nowIso(),
      summary: {
        reason: "schema_push_failed",
      },
    }, runEntityId);
    throw new Error("Schema push failed.");
  }

  const planStarted = nowIso();
  const planned = await planSchemaPush(targetAppId, targetAdminToken, targetSchema);
  await storeArtifact(ctx, "schema_plan_after_push", "schema_plan", "schema.plan.after-push", planned);
  await markStep(ctx, "schema_plan_after_push", planned.ok ? "ok" : "error", {
    status: planned.status,
  }, planStarted);
  if (!planned.ok) {
    await storeEntity(migrationAppId, migrationAdminToken, "migration_runs", {
      orgId,
      status: "failed",
      endedAt: nowIso(),
      summary: {
        reason: "plan_failed_after_push",
        plan: planned,
      },
    }, runEntityId);
    throw new Error(`Plan failed after push (${planned.status}).`);
  }

  const transformedInputFile = path.join(skillRoot, "artifacts", "datasets", `source.${runId}.json`);
  const transformedOutputFile = path.join(skillRoot, "artifacts", "transformed", `story-thread-target.${runId}.json`);
  await fs.mkdir(path.dirname(transformedInputFile), { recursive: true });
  await fs.mkdir(path.dirname(transformedOutputFile), { recursive: true });
  await fs.writeFile(transformedInputFile, JSON.stringify({ data: sourceData }, null, 2), "utf8");

  const transformStarted = nowIso();
  const transformResult = await runCommand(
    process.execPath,
    [
      path.join(scriptsDir, "transform_story_to_thread_dataset.mjs"),
      "--org",
      orgId,
      "--input",
      transformedInputFile,
      "--output",
      transformedOutputFile,
      "--run-id",
      runId,
    ],
    skillRoot,
  );
  await storeArtifact(ctx, "transform", "command_result", "transform.command", transformResult);
  if (!transformResult.ok) {
    await markStep(ctx, "transform", "error", transformResult, transformStarted);
    throw new Error("Transform step failed.");
  }

  const transformedData = await readJson(transformedOutputFile);
  await storeArtifact(ctx, "transform", "transform_output", "transform.output", transformedData);
  await markStep(ctx, "transform", "ok", {
    records: Array.isArray(transformedData?.records) ? transformedData.records.length : 0,
    linkIntents: Array.isArray(transformedData?.linkIntents) ? transformedData.linkIntents.length : 0,
    warnings: Array.isArray(transformedData?.warnings) ? transformedData.warnings.length : 0,
  }, transformStarted);

  const txPlanStarted = nowIso();
  const txPlan = transformedToSteps(transformedData);
  await storeArtifact(ctx, "tx_plan", "tx_plan", "tx.plan", txPlan);
  await markStep(ctx, "tx_plan", "ok", {
    source: txPlan.source,
    steps: txPlan.steps.length,
    warnings: txPlan.warnings.length,
  }, txPlanStarted);

  const txApplyStarted = nowIso();
  let txApplyResult = {
    dryRun,
    batches: [],
  };
  if (!dryRun) {
    txApplyResult = {
      dryRun: false,
      batches: await applyStepsBatched(targetAppId, targetAdminToken, txPlan.steps, 200),
    };
  }
  await storeArtifact(ctx, "tx_apply", "tx_apply_result", "tx.apply.result", txApplyResult);
  await markStep(ctx, "tx_apply", "ok", {
    dryRun,
    stepCount: txPlan.steps.length,
    batchCount: Array.isArray(txApplyResult?.batches) ? txApplyResult.batches.length : 0,
  }, txApplyStarted);

  const verifyStarted = nowIso();
  let verifyData;
  let effectiveVerifyQuery = verifyQuery;
  try {
    verifyData = await adminQuery(targetAppId, targetAdminToken, effectiveVerifyQuery);
  } catch (error) {
    const stripped = stripOrderClauses(verifyQuery);
    verifyData = await adminQuery(targetAppId, targetAdminToken, stripped);
    effectiveVerifyQuery = stripped;
    await storeArtifact(ctx, "verify", "warning", "verify.order-fallback", {
      message: String(error?.message || error),
      fallback: "Removed non-indexed order clauses from verify query.",
    });
  }
  await storeArtifact(ctx, "verify", "query", "verify.query", effectiveVerifyQuery);
  await storeArtifact(ctx, "verify", "verify_result", "verify.result", verifyData);
  await markStep(ctx, "verify", "ok", {
    entityCounts: countByEntity(verifyData),
  }, verifyStarted);

  const domainSnapshot = await adminQuery(migrationAppId, migrationAdminToken, {
    migration_runs: {},
    migration_steps: {},
    migration_artifacts: {},
    migration_payload_chunks: {},
    migration_reports: {},
  });

  const finalReport = {
    ok: true,
    runId,
    orgId,
    targetAppId,
    targetAdminToken,
    migrationAppId,
    migrationAdminToken,
    finishedAt: nowIso(),
    summary: {
      txSteps: txPlan.steps.length,
      txWarnings: txPlan.warnings.length,
      verifyCounts: countByEntity(verifyData),
      migrationDomainCounts: countByEntity(domainSnapshot),
    },
  };

  await storeEntity(migrationAppId, migrationAdminToken, "migration_reports", {
    runId,
    status: "completed",
    report: finalReport,
    createdAt: nowIso(),
  });
  await storeEntity(migrationAppId, migrationAdminToken, "migration_runs", {
    orgId,
    status: "completed",
    endedAt: nowIso(),
    summary: finalReport.summary,
  }, runEntityId);

  const finalDomainState = await adminQuery(migrationAppId, migrationAdminToken, {
    migration_runs: {},
    migration_steps: {},
    migration_artifacts: {},
    migration_payload_chunks: {},
    migration_reports: {},
  });

  const output = {
    ok: true,
    runId,
    targetAppId,
    targetAdminToken,
    migrationAppId,
    migrationAdminToken,
    reportFromMigrationDomain: finalDomainState,
  };

  const outFile = path.resolve(
    String(arg("out", path.join(skillRoot, "artifacts", "reports", `migration.temp-domain.${runId}.json`))),
  );
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ...output, outFile }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
