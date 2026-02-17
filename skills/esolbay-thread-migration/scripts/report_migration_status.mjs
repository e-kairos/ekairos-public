#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { writeMigrationAudit } from "./_migration_audit.mjs";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function parseIso(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function statusFromRow(row, applyRecord, verifyRecord) {
  const planBlocked = String(row?.plan?.gate || "") === "blocked" || String(row?.plan?.status || "") !== "ok";
  if (planBlocked) return "blocked_plan";
  if (!applyRecord) return "planned_only";
  if (!verifyRecord) return "applied_unverified";
  return "migrated_verified";
}

async function loadAuditRecords(auditDir, suffix) {
  const records = [];
  if (!fsSync.existsSync(auditDir)) return records;
  const names = await fs.readdir(auditDir);
  const candidates = names.filter((name) => name.endsWith(suffix));
  for (const name of candidates) {
    const filePath = path.join(auditDir, name);
    try {
      const json = await readJson(filePath);
      records.push({ filePath, json });
    } catch {
      // ignore invalid audit record
    }
  }
  return records;
}

function pickLatestByOrg(records, predicate) {
  const byOrg = new Map();
  for (const record of records) {
    const json = record.json || {};
    const orgId = String(json.orgId || "").trim();
    if (!orgId) continue;
    if (!predicate(json)) continue;
    const current = byOrg.get(orgId);
    const ts = parseIso(json.createdAt);
    if (!current || ts >= current.ts) {
      byOrg.set(orgId, {
        ts,
        createdAt: String(json.createdAt || ""),
        filePath: record.filePath,
        payload: json.payload ?? null,
      });
    }
  }
  return byOrg;
}

async function main() {
  const matrixPath = path.resolve(arg("matrix"));
  const outPath = path.resolve(arg("out"));
  const auditDir = path.resolve(arg("audit-dir", ".migration-audit"));
  const runId = String(arg("run-id", `mig-${Date.now()}`));

  if (!matrixPath || !outPath) {
    throw new Error(
      "usage: report_migration_status.mjs --matrix <schema-plan-org-matrix.json> --out <migration-status.json> [--audit-dir .migration-audit] [--run-id id]",
    );
  }

  const matrix = await readJson(matrixPath);
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];

  await writeMigrationAudit({
    runId,
    script: "report_migration_status",
    stage: "snapshot",
    payload: {
      matrixPath,
      auditDir,
      totalRows: rows.length,
    },
  });

  const applyRecords = await loadAuditRecords(auditDir, ".apply_instant_tx.final.json");
  const verifyRecords = await loadAuditRecords(auditDir, ".verify_migration.final.json");

  const latestApplyByOrg = pickLatestByOrg(
    applyRecords,
    (json) => json?.payload?.mode === "apply" && json?.payload?.ok === true,
  );
  const latestVerifyByOrg = pickLatestByOrg(
    verifyRecords,
    (json) => json?.payload?.ok === true && Number(json?.payload?.status || 0) >= 200 && Number(json?.payload?.status || 0) < 300,
  );

  const resultRows = rows.map((row) => {
    const orgId = String(row?.org?.id || "");
    const applyRecord = latestApplyByOrg.get(orgId) || null;
    const verifyRecord = latestVerifyByOrg.get(orgId) || null;
    return {
      orgId,
      orgName: String(row?.org?.name || ""),
      appId: String(row?.instant?.appId || ""),
      planStatus: String(row?.plan?.status || ""),
      planGate: String(row?.plan?.gate || ""),
      status: statusFromRow(row, applyRecord, verifyRecord),
      issueCode: String(row?.actionPlan?.issueCode || ""),
      planId: String(row?.actionPlan?.planId || ""),
      evidence: {
        planError: String(row?.plan?.error || ""),
        applyAuditFile: applyRecord?.filePath || null,
        applyAt: applyRecord?.createdAt || null,
        verifyAuditFile: verifyRecord?.filePath || null,
        verifyAt: verifyRecord?.createdAt || null,
      },
    };
  });

  const summary = {
    total: resultRows.length,
    blocked_plan: resultRows.filter((row) => row.status === "blocked_plan").length,
    planned_only: resultRows.filter((row) => row.status === "planned_only").length,
    applied_unverified: resultRows.filter((row) => row.status === "applied_unverified").length,
    migrated_verified: resultRows.filter((row) => row.status === "migrated_verified").length,
  };

  const report = {
    ok: true,
    createdAt: new Date().toISOString(),
    matrixPath,
    auditDir,
    summary,
    rows: resultRows,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  await writeMigrationAudit({
    runId,
    script: "report_migration_status",
    stage: "final",
    payload: {
      outPath,
      summary,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: outPath,
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
